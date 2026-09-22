const STATE_ID = "nespoli-concreto-main";
const MAX_BODY_BYTES = 1_000_000;
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const STATIC_FILES = /*__STATIC_FILES__*/ {};
const textEncoder = new TextEncoder();

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  }
});

function html(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      ...extraHeaders
    }
  });
}

function loginPage(message = "") {
  const warning = message ? `<p class="error" role="alert">${message}</p>` : "";
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Acesso privado • Nespoli Concreto</title><style>
  :root{font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#102038;background:#eef1f5}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:22px;background:radial-gradient(circle at top,#fff7c7 0,#eef1f5 36%)}main{width:min(430px,100%);padding:30px;border:1px solid #d8dee8;border-radius:20px;background:#fff;box-shadow:0 20px 60px rgba(16,32,56,.14)}.brand{display:flex;align-items:center;gap:12px;margin-bottom:25px}.mark{display:grid;place-items:center;width:54px;height:54px;border-radius:14px;background:#151515;color:#ffd229;font-size:22px;font-weight:900}.eyebrow{margin:0;color:#936f00;font-size:12px;font-weight:900;letter-spacing:.13em}.brand strong{font-size:20px}h1{margin:0 0 8px;font-size:28px}p{margin:0 0 20px;color:#667185;line-height:1.5}label{display:block;margin-bottom:7px;font-weight:800}input{width:100%;min-height:50px;padding:10px 13px;border:1px solid #bfc9d8;border-radius:10px;font:inherit}input:focus{outline:3px solid rgba(255,210,41,.35);border-color:#c99f00}button{width:100%;min-height:50px;margin-top:14px;border:0;border-radius:10px;background:#ffd229;color:#161616;font:inherit;font-weight:900;cursor:pointer}.error{margin:0 0 16px;padding:11px 13px;border-radius:9px;background:#fff0ec;color:#a33a18;font-weight:700}.privacy{margin:18px 0 0;font-size:12px;text-align:center}
  </style></head><body><main><div class="brand"><div class="mark">NC</div><div><p class="eyebrow">NESPOLI CONCRETO</p><strong>Ponto e pagamentos</strong></div></div><h1>Acesso privado</h1><p>Digite a senha definida na implantação da Cloudflare.</p>${warning}<form method="post" action="/login"><label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">Entrar</button></form><p class="privacy">Dados protegidos e não indexados por buscadores.</p></main></body></html>`;
}

function secureEqual(left, right) {
  const a = textEncoder.encode(String(left || ""));
  const b = textEncoder.encode(String(right || ""));
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

async function signSession(expiresAt, secret) {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(String(expiresAt)));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hasValidSession(request, secret) {
  const token = getCookie(request, "nespoli_session");
  const [expiresRaw, signature] = token.split(".");
  const expiresAt = Number(expiresRaw);
  if (!expiresRaw || !signature || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  return secureEqual(signature, await signSession(expiresAt, secret));
}

async function handleLogin(request, env) {
  if (!env.APP_PASSWORD) return html(loginPage("A senha do aplicativo ainda não foi configurada na Cloudflare."), 503);
  if (request.method === "GET") return html(loginPage());
  if (request.method !== "POST") return new Response("Método não permitido.", { status: 405 });
  const form = await request.formData();
  if (!secureEqual(form.get("password"), env.APP_PASSWORD)) return html(loginPage("Senha incorreta. Tente novamente."), 401);
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const signature = await signSession(expiresAt, env.APP_PASSWORD);
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/",
      "Set-Cookie": `nespoli_session=${expiresAt}.${signature}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
      "Cache-Control": "no-store"
    }
  });
}

async function ensureSchema(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    )
  `).run();
}

async function readState(db) {
  const row = await db.prepare(
    "SELECT payload, revision, updated_at FROM app_state WHERE id = ?"
  ).bind(STATE_ID).first();
  if (!row) return { state: null, revision: 0, updatedAt: null };
  try {
    return { state: JSON.parse(row.payload), revision: Number(row.revision) || 0, updatedAt: row.updated_at };
  } catch {
    return { state: null, revision: Number(row.revision) || 0, updatedAt: row.updated_at };
  }
}

async function writeState(request, db) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return json({ error: "Backup muito grande." }, 413);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Conteúdo inválido." }, 400);
  }
  const nextState = body?.state;
  const baseRevision = Number(body?.baseRevision);
  if (!nextState || !Array.isArray(nextState.employees) || !Array.isArray(nextState.entries) || !Array.isArray(nextState.advances)) {
    return json({ error: "Estrutura de dados inválida." }, 400);
  }
  const payload = JSON.stringify(nextState);
  if (new TextEncoder().encode(payload).byteLength > MAX_BODY_BYTES) return json({ error: "Backup muito grande." }, 413);

  const updatedAt = nextState.updatedAt || new Date().toISOString();
  const saved = await db.prepare(`
    INSERT INTO app_state (id, payload, revision, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload = excluded.payload,
      revision = app_state.revision + 1,
      updated_at = excluded.updated_at
    WHERE app_state.revision = ?
    RETURNING revision, updated_at
  `).bind(STATE_ID, payload, updatedAt, baseRevision).first();

  if (!saved) return json(await readState(db), 409);
  return json({ ok: true, revision: Number(saved.revision), updatedAt: saved.updated_at });
}

async function handleApi(request, env) {
  if (!env.DB) return json({ error: "Armazenamento ainda não configurado." }, 503);
  await ensureSchema(env.DB);
  if (request.method === "GET") return json(await readState(env.DB));
  if (request.method === "PUT") return writeState(request, env.DB);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { Allow: "GET, PUT, OPTIONS" } });
  return json({ error: "Método não permitido." }, 405);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function serveStatic(request, pathname) {
  const asset = STATIC_FILES[pathname === "/" ? "/index.html" : pathname];
  if (!asset) return new Response("Página não encontrada.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const cacheControl = asset.contentType.startsWith("image/") ? "public, max-age=86400" : "no-cache";
  const headers = new Headers({
    "Content-Type": asset.contentType,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  });
  return new Response(request.method === "HEAD" ? null : decodeBase64(asset.body), { status: 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/login") return handleLogin(request, env);
    if (url.pathname === "/logout" && request.method === "POST") {
      return new Response(null, { status: 303, headers: { Location: "/login", "Set-Cookie": "nespoli_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict", "Cache-Control": "no-store" } });
    }
    if (!env.APP_PASSWORD) return html(loginPage("A senha do aplicativo ainda não foi configurada na Cloudflare."), 503);
    if (!await hasValidSession(request, env.APP_PASSWORD)) {
      if (url.pathname === "/api/state") return json({ error: "Acesso não autorizado." }, 401);
      return new Response(null, { status: 303, headers: { Location: "/login", "Cache-Control": "no-store" } });
    }
    if (url.pathname === "/api/state") return handleApi(request, env);
    if (request.method === "GET" || request.method === "HEAD") return serveStatic(request, url.pathname);
    return new Response("Método não permitido.", { status: 405 });
  }
};

export { ensureSchema, handleApi, readState, serveStatic, writeState };
