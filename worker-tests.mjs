import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./worker.js", import.meta.url), "utf8");
const worker = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const builtSource = await readFile(new URL("./index.js", import.meta.url), "utf8");
const builtWorker = await import(`data:text/javascript;base64,${Buffer.from(builtSource).toString("base64")}`);

class MemoryDB {
  constructor() { this.row = null; }
  prepare(sql) {
    const db = this;
    return {
      bind(...values) {
        return {
          async run() {
            if (/CREATE TABLE/i.test(sql)) return { success: true };
            throw new Error(`SQL inesperado em run: ${sql}`);
          },
          async first() {
            if (/SELECT payload/i.test(sql)) return db.row;
            if (/INSERT INTO app_state/i.test(sql)) {
              const [, payload, updatedAt, baseRevision] = values;
              if (db.row && db.row.revision !== baseRevision) return null;
              db.row = { payload, revision: db.row ? db.row.revision + 1 : 1, updated_at: updatedAt };
              return { revision: db.row.revision, updated_at: db.row.updated_at };
            }
            throw new Error(`SQL inesperado em first: ${sql}`);
          }
        };
      },
      async run() {
        if (/CREATE TABLE/i.test(sql)) return { success: true };
        throw new Error(`SQL inesperado em run: ${sql}`);
      }
    };
  }
}

const env = { DB: new MemoryDB(), APP_PASSWORD: "senha-de-teste-forte" };
const emptyResponse = await worker.handleApi(new Request("http://local/api/state"), env);
assert.equal(emptyResponse.status, 200);
assert.deepEqual(await emptyResponse.json(), { state: null, revision: 0, updatedAt: null });

const state = { version: 2, employees: [], entries: [], advances: [], updatedAt: "2026-09-16T13:00:00.000Z" };
const saveResponse = await worker.handleApi(new Request("http://local/api/state", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ state, baseRevision: 0 })
}), env);
assert.equal(saveResponse.status, 200);
assert.equal((await saveResponse.json()).revision, 1);

const savedResponse = await worker.handleApi(new Request("http://local/api/state"), env);
assert.deepEqual(await savedResponse.json(), { state, revision: 1, updatedAt: state.updatedAt });

const conflictResponse = await worker.handleApi(new Request("http://local/api/state", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ state: { ...state, updatedAt: "2026-09-16T13:01:00.000Z" }, baseRevision: 0 })
}), env);
assert.equal(conflictResponse.status, 409);
assert.equal((await conflictResponse.json()).revision, 1);

const loginPageResponse = await builtWorker.default.fetch(new Request("http://local/login"), env);
assert.equal(loginPageResponse.status, 200);
assert.match(await loginPageResponse.text(), /Acesso privado/);

const unauthorizedApiResponse = await builtWorker.default.fetch(new Request("http://local/api/state"), env);
assert.equal(unauthorizedApiResponse.status, 401);

const wrongLoginResponse = await builtWorker.default.fetch(new Request("http://local/login", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ password: "senha-incorreta" })
}), env);
assert.equal(wrongLoginResponse.status, 401);

const loginResponse = await builtWorker.default.fetch(new Request("http://local/login", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ password: env.APP_PASSWORD })
}), env);
assert.equal(loginResponse.status, 303);
assert.equal(loginResponse.headers.get("location"), "/");
const sessionCookie = loginResponse.headers.get("set-cookie").split(";")[0];

const pageResponse = await builtWorker.default.fetch(new Request("http://local/", {
  headers: { Cookie: sessionCookie }
}), env);
assert.equal(pageResponse.status, 200);
assert.match(pageResponse.headers.get("content-type"), /text\/html/);
assert.match(await pageResponse.text(), /Nespoli Concreto/);

const authorizedApiResponse = await builtWorker.default.fetch(new Request("http://local/api/state", {
  headers: { Cookie: sessionCookie }
}), env);
assert.equal(authorizedApiResponse.status, 200);
assert.equal((await authorizedApiResponse.json()).revision, 1);

const logoutResponse = await builtWorker.default.fetch(new Request("http://local/logout", {
  method: "POST",
  headers: { Cookie: sessionCookie }
}), env);
assert.equal(logoutResponse.status, 303);
assert.match(logoutResponse.headers.get("set-cookie"), /Max-Age=0/);

console.log("Todos os testes de sincronização e acesso privado passaram.");
