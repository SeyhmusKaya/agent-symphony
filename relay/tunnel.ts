import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import { ProjectStore } from "../orchestrator/project.js";

interface Secrets {
  relay: { domain: string; tunnelSecret: string };
}

function loadSecrets(): Secrets {
  const path = process.env.ARCHITECT_SECRETS ?? join(process.cwd(), "secrets.local.json");
  return JSON.parse(readFileSync(path, "utf8")) as Secrets;
}

function projectsFile(): string {
  const appData =
    process.env.APPDATA ?? join(process.env.HOME ?? ".", ".config");
  return join(appData, "com.seyh.architect", "projects.json");
}

const secrets = loadSecrets();
const RELAY_URL = `wss://${secrets.relay.domain}/tunnel`;
const ORCH_ENTRY = join(process.cwd(), "orchestrator", "main.ts");

interface RunningProject {
  port: number;
  child: ChildProcess;
  ws: WebSocket | null;
}

const running = new Map<string, RunningProject>();
let relay: WebSocket | null = null;

function sendToRelay(msg: unknown): void {
  if (relay?.readyState === WebSocket.OPEN) relay.send(JSON.stringify(msg));
}

function listProjects() {
  const file = projectsFile();
  if (!existsSync(file)) return [];
  return new ProjectStore(file).list();
}

function openProject(projectId: string): void {
  const existing = running.get(projectId);
  if (existing) {
    connectOrchestrator(projectId, existing);
    return;
  }
  const project = listProjects().find((p) => p.id === projectId);
  if (!project) {
    sendToRelay({ kind: "hata", mesaj: "Project not found." });
    return;
  }
  const port = 4317 + running.size;
  const child = spawn("node", ["--import", "tsx", ORCH_ENTRY, String(port), project.path], {
    cwd: process.cwd(),
    stdio: "ignore",
    windowsHide: true,
  });
  const entry: RunningProject = { port, child, ws: null };
  running.set(projectId, entry);
  setTimeout(() => connectOrchestrator(projectId, entry), 1500);
}

function requestStatus(entry: RunningProject): void {
  if (entry.ws?.readyState === WebSocket.OPEN) {
    entry.ws.send(JSON.stringify({ kind: "durum_iste" }));
  }
}

function connectOrchestrator(projectId: string, entry: RunningProject): void {
  if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
    requestStatus(entry);
    return;
  }
  const ws = new WebSocket(`ws://127.0.0.1:${entry.port}`);
  entry.ws = ws;
  ws.on("open", () => requestStatus(entry));
  ws.on("message", (raw) => {
    sendToRelay({ kind: "orkestrator", projectId, msg: JSON.parse(raw.toString()) });
  });
  ws.on("close", () => {
    entry.ws = null;
  });
  ws.on("error", () => {
    entry.ws = null;
  });
}

function handleWebMessage(text: string): void {
  let msg: { kind?: string; projectId?: string; text?: string };
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg.kind === "projeler_iste") {
    sendToRelay({ kind: "projeler", projects: listProjects() });
  } else if (msg.kind === "proje_ac" && msg.projectId) {
    openProject(msg.projectId);
  } else if (msg.kind === "komut" && msg.projectId && msg.text) {
    const entry = running.get(msg.projectId);
    if (entry?.ws?.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify({ kind: "komut", text: msg.text }));
    } else {
      openProject(msg.projectId);
    }
  }
}

function connectRelay(): void {
  const ws = new WebSocket(RELAY_URL);
  relay = ws;
  ws.on("open", () => {
    ws.send(JSON.stringify({ kind: "auth", secret: secrets.relay.tunnelSecret }));
  });
  ws.on("message", (raw) => {
    const text = raw.toString();
    let msg: { kind?: string };
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (msg.kind === "auth_ok") {
      console.log("Tunnel connected to relay.");
      return;
    }
    if (msg.kind === "auth_fail") {
      console.error("Tunnel authentication failed.");
      return;
    }
    handleWebMessage(text);
  });
  ws.on("close", () => {
    relay = null;
    setTimeout(connectRelay, 3000);
  });
  ws.on("error", () => {
    /* close handler reconnects */
  });
}

connectRelay();
console.log(`Architect tunnel — relay ${RELAY_URL}`);
