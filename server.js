// Servidor local de desenvolvimento: serve /public e repassa /api/<função> às Edge Functions,
// adicionando x-app-key no servidor (a chave nunca vai para o navegador).
const http = require("http");
const fs = require("fs");
const path = require("path");

function loadEnv(file) {
  const p = path.join(__dirname, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    process.env[t.slice(0, i).trim()] ??= t.slice(i + 1).trim();
  }
}
loadEnv(".env");
loadEnv(".env.web");

const { FUNCTIONS_URL, ANON_KEY, APP_ACCESS_KEY } = process.env;
const PORT = process.env.PORT || 3100;
const ALLOWED = new Set(["list-avatars", "register-avatar", "generate-video", "get-video-status"]);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript" };

if (!FUNCTIONS_URL || !ANON_KEY || !APP_ACCESS_KEY) {
  console.error("Faltam FUNCTIONS_URL/ANON_KEY (.env.web) ou APP_ACCESS_KEY (.env).");
  process.exit(1);
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/")) {
    const fn = url.pathname.slice(5);
    if (!ALLOWED.has(fn)) { res.writeHead(404); return res.end("not found"); }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const upstream = await fetch(`${FUNCTIONS_URL}/${fn}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ANON_KEY}`,
        "x-app-key": APP_ACCESS_KEY,
        "Content-Type": "application/json",
      },
      body: Buffer.concat(chunks).toString() || "{}",
    }).catch((e) => ({ status: 502, text: async () => JSON.stringify({ error: e.message }) }));
    res.writeHead(upstream.status, { "Content-Type": "application/json" });
    return res.end(await upstream.text());
  }

  const file = path.join(__dirname, "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(path.join(__dirname, "public")) || !fs.existsSync(file)) {
    res.writeHead(404); return res.end("not found");
  }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`Plataforma em http://localhost:${PORT}`));
