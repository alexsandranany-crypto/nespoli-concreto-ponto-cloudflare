import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = new URL("./", import.meta.url);
const files = [
  ["/index.html", "index.html"],
  ["/styles.css", "styles.css"],
  ["/logic.js", "logic.js"],
  ["/app.js", "app.js"],
  ["/assets/logo-nespoli-concreto.png", "assets/logo-nespoli-concreto.png"]
];
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png"
};

const staticFiles = {};
for (const [route, file] of files) {
  const bytes = await readFile(new URL(file, root));
  staticFiles[route] = {
    contentType: contentTypes[extname(file)] || "application/octet-stream",
    body: bytes.toString("base64")
  };
}

const template = await readFile(new URL("worker.js", root), "utf8");
const marker = "/*__STATIC_FILES__*/ {}";
if (!template.includes(marker)) throw new Error("Marcador de arquivos estáticos não encontrado.");
const output = template.replace(marker, JSON.stringify(staticFiles));
const projectRoot = resolve(new URL(root).pathname);
const target = resolve(projectRoot, "index.js");
const deployTarget = resolve(projectRoot, "dist/server/index.js");
await mkdir(resolve(projectRoot, "dist/server"), { recursive: true });
await Promise.all([writeFile(target, output), writeFile(deployTarget, output)]);
console.log(`Worker gerado com ${files.length} arquivos.`);
