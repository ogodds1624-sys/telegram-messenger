const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT) || 5500;
const zlib = require("zlib");

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const compressible = {
  ".html": true,
  ".css": true,
  ".js": true,
  ".svg": true,
  ".csv": true,
};

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const file = path.resolve(root, "." + pathname);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(file, function (err, data) {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(file).toLowerCase();
    const headers = {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": ext === ".html" ? "no-cache" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    };
    const accept = req.headers["accept-encoding"] || "";
    if (compressible[ext] && accept.indexOf("gzip") !== -1) {
      zlib.gzip(data, function (zipErr, zipped) {
        if (zipErr) {
          res.writeHead(200, headers);
          res.end(data);
          return;
        }
        headers["Content-Encoding"] = "gzip";
        headers.Vary = "Accept-Encoding";
        res.writeHead(200, headers);
        res.end(zipped);
      });
      return;
    }
    res.writeHead(200, headers);
    res.end(data);
  });
});

server.listen(port, "127.0.0.1", function () {
  console.log("Spreadsheet running at http://127.0.0.1:" + port);
});
