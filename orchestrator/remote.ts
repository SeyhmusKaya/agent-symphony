import { WebSocket } from "ws";

export interface RemoteCallResult {
  ok: boolean;
  response: string;
}

export interface RemoteAuth {
  header?: string;
  token?: string;
}

const TIMEOUT_MS = 30000;

async function callHttp(
  endpoint: string,
  message: string,
  auth?: RemoteAuth,
): Promise<RemoteCallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth?.token) headers[auth.header ?? "authorization"] = auth.token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ message }),
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, response: text };
  } catch (e) {
    return { ok: false, response: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

function callWs(endpoint: string, message: string, auth?: RemoteAuth): Promise<RemoteCallResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(endpoint);
    const timer = setTimeout(() => {
      ws.close();
      resolve({ ok: false, response: "Zaman asimi." });
    }, TIMEOUT_MS);

    ws.on("open", () => {
      if (auth?.token) ws.send(JSON.stringify({ kind: "auth", token: auth.token }));
      ws.send(JSON.stringify({ message }));
    });
    ws.on("message", (raw) => {
      clearTimeout(timer);
      ws.close();
      resolve({ ok: true, response: raw.toString() });
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, response: (e as Error).message });
    });
  });
}

export function callRemoteAgent(
  endpoint: string,
  message: string,
  auth?: RemoteAuth,
): Promise<RemoteCallResult> {
  if (endpoint.startsWith("ws://") || endpoint.startsWith("wss://")) {
    return callWs(endpoint, message, auth);
  }
  return callHttp(endpoint, message, auth);
}
