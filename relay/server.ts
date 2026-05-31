import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

interface RelayConfig {
  port: number;
  tunnelSecret: string;
  webAuth: { username: string; password: string };
  webDir: string;
}

function loadConfig(): RelayConfig {
  const path = process.env.RELAY_CONFIG ?? join(process.cwd(), "relay.config.json");
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<RelayConfig>;
  return {
    port: raw.port ?? 4500,
    tunnelSecret: raw.tunnelSecret ?? "",
    webAuth: raw.webAuth ?? { username: "", password: "" },
    webDir: raw.webDir ?? join(process.cwd(), "web"),
  };
}

const config = loadConfig();
const tokens = new Set<string>();

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json" });
  res.end(data);
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  const urlPath = (req.url ?? "/").split("?")[0];
  let rel = normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  if (rel === "/" || rel === "\\") rel = "/index.html";
  let file = join(config.webDir, rel);
  if (!existsSync(file)) {
    if (extname(rel)) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("Not found.");
      return;
    }
    file = join(config.webDir, "index.html");
  }
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end("Architect relay — web UI not found.");
    return;
  }
  const ext = extname(file).toLowerCase();
  const headers: Record<string, string> = {
    "content-type": MIME[ext] ?? "application/octet-stream",
  };
  headers["cache-control"] = ext === ".html" ? "no-cache" : "public, max-age=31536000";
  res.writeHead(200, headers);
  res.end(readFileSync(file));
}

const httpServer = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/login") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { username, password } = JSON.parse(body) as {
          username: string;
          password: string;
        };
        if (
          username === config.webAuth.username &&
          password === config.webAuth.password
        ) {
          const token = randomBytes(24).toString("hex");
          tokens.add(token);
          sendJson(res, 200, { token });
        } else {
          sendJson(res, 401, { error: "Username or password is incorrect." });
        }
      } catch {
        sendJson(res, 400, { error: "Invalid request." });
      }
    });
    return;
  }
  serveStatic(req, res);
});

let pcSocket: WebSocket | null = null;
const browsers = new Set<WebSocket>();

const wss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const path = (req.url ?? "").split("?")[0];
  if (path !== "/ws" && path !== "/tunnel") {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws, path);
  });
});

function broadcastBrowsers(data: string): void {
  for (const b of browsers) {
    if (b.readyState === WebSocket.OPEN) b.send(data);
  }
}

function handleConnection(ws: WebSocket, path: string): void {
  let authed = false;
  let role: "pc" | "browser" | null = null;

  ws.on("message", (raw) => {
    const text = raw.toString();
    if (!authed) {
      let msg: { kind?: string; secret?: string; token?: string };
      try {
        msg = JSON.parse(text);
      } catch {
        ws.close();
        return;
      }
      if (msg.kind !== "auth") {
        ws.close();
        return;
      }
      if (path === "/tunnel" && msg.secret === config.tunnelSecret) {
        authed = true;
        role = "pc";
        pcSocket = ws;
        ws.send(JSON.stringify({ kind: "auth_ok" }));
      } else if (path === "/ws" && msg.token && tokens.has(msg.token)) {
        authed = true;
        role = "browser";
        browsers.add(ws);
        ws.send(
          JSON.stringify({ kind: "auth_ok", pcOnline: pcSocket?.readyState === WebSocket.OPEN }),
        );
      } else {
        ws.send(JSON.stringify({ kind: "auth_fail" }));
        ws.close();
      }
      return;
    }

    if (role === "browser") {
      if (pcSocket?.readyState === WebSocket.OPEN) pcSocket.send(text);
      else ws.send(JSON.stringify({ kind: "pc_yok" }));
    } else if (role === "pc") {
      broadcastBrowsers(text);
    }
  });

  ws.on("close", () => {
    if (role === "pc" && pcSocket === ws) {
      pcSocket = null;
      broadcastBrowsers(JSON.stringify({ kind: "pc_yok" }));
    } else if (role === "browser") {
      browsers.delete(ws);
    }
  });
}

httpServer.listen(config.port, "127.0.0.1", () => {
  console.log(`Architect relay running — 127.0.0.1:${config.port}`);
});
