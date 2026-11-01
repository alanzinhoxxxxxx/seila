require("dotenv").config({ path: require("node:path").join(__dirname, "..", ".env") });
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");

const DATA_FILE = path.join(__dirname, "..", "data", "store.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const PORT = process.env.WEB_PORT || 3000;

// Mapa de extensões → MIME types
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
  ".svg":  "image/svg+xml",
  ".woff2": "font/woff2",
};

async function readStock() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const state = JSON.parse(raw);
    return {
      rockstar:    (state.stock?.rockstar    ?? []).length,
      discord:     (state.stock?.discord     ?? []).length,
      steam:       (state.stock?.steam       ?? []).length,
      rockstar_50: (state.stock?.rockstar_50 ?? []).length,
    };
  } catch {
    return { rockstar: 0, discord: 0, steam: 0, rockstar_50: 0 };
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost`);

  // CORS para desenvolvimento local
  res.setHeader("Access-Control-Allow-Origin", "*");

  // API de estoque
  if (url.pathname === "/api/stock") {
    const stock = await readStock();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(stock));
    return;
  }

  // Arquivos estáticos
  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);

  // Impede path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    // Fallback para index.html (SPA)
    try {
      const data = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  }
});

server.listen(PORT, () => {
  console.log(`Servidor web rodando em http://localhost:${PORT}`);
});
