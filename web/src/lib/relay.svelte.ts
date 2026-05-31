export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpened: number;
}

export interface AgentInfo {
  name: string;
  role: string;
  model: string;
  effort: string;
  skills: string[];
}

export type AgentStatus = "bos" | "calisiyor" | "hata";

export interface AgentView extends AgentInfo {
  status: AgentStatus;
  task: string | null;
}

export interface FeedEvent {
  type: string;
  payload: Record<string, unknown>;
  ts: number;
  uid: number;
}

export interface WorkerView {
  id: number;
  task: string;
  done: boolean;
  isError: boolean;
}

export interface ChatMessage {
  role: "kullanici" | "sef";
  text: string;
  ts: number;
}

export type Stage = "login" | "launcher" | "project";

interface OrchStatus {
  agents?: AgentInfo[];
  chat?: ChatMessage[];
}

class Relay {
  stage = $state<Stage>("login");
  loginError = $state("");
  loggingIn = $state(false);
  connected = $state(false);
  pcOnline = $state(false);

  projects = $state<Project[]>([]);
  activeProject = $state<Project | null>(null);

  agents = $state<AgentView[]>([]);
  feed = $state<FeedEvent[]>([]);
  workers = $state<WorkerView[]>([]);
  chat = $state<ChatMessage[]>([]);
  tokensIn = $state(0);
  tokensOut = $state(0);

  private ws: WebSocket | null = null;
  private token = "";
  private workerSeq = 0;
  private feedSeq = 0;

  async login(username: string, password: string): Promise<void> {
    this.loggingIn = true;
    this.loginError = "";
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        this.loginError = body.error ?? "Login failed.";
        return;
      }
      const { token } = (await res.json()) as { token: string };
      this.token = token;
      sessionStorage.setItem("arc_token", token);
      this.openSocket();
    } catch {
      this.loginError = "Could not reach the server.";
    } finally {
      this.loggingIn = false;
    }
  }

  tryResume(): void {
    const saved = sessionStorage.getItem("arc_token");
    if (saved) {
      this.token = saved;
      this.openSocket();
    }
  }

  private openSocket(): void {
    const ws = new WebSocket(`wss://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ kind: "auth", token: this.token }));
    ws.onclose = () => {
      this.connected = false;
      if (this.stage !== "login") setTimeout(() => this.openSocket(), 2500);
    };
    ws.onmessage = (e) => this.handle(JSON.parse(e.data));
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  refreshProjects(): void {
    this.send({ kind: "projeler_iste" });
  }

  openProject(p: Project): void {
    this.activeProject = p;
    this.agents = [];
    this.feed = [];
    this.workers = [];
    this.chat = [];
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.stage = "project";
    this.send({ kind: "proje_ac", projectId: p.id });
  }

  leaveProject(): void {
    this.activeProject = null;
    this.stage = "launcher";
    this.refreshProjects();
  }

  sendCommand(text: string): void {
    if (!this.activeProject) return;
    this.chat.push({ role: "kullanici", text, ts: Date.now() });
    this.send({ kind: "komut", projectId: this.activeProject.id, text });
  }

  private handle(msg: Record<string, unknown>): void {
    switch (msg.kind) {
      case "auth_ok":
        this.connected = true;
        this.pcOnline = Boolean(msg.pcOnline);
        if (this.stage === "login") this.stage = "launcher";
        this.refreshProjects();
        break;
      case "auth_fail":
        this.loginError = "Session invalid, please log in again.";
        sessionStorage.removeItem("arc_token");
        this.stage = "login";
        break;
      case "pc_yok":
        this.pcOnline = false;
        break;
      case "projeler":
        this.pcOnline = true;
        this.projects = (msg.projects as Project[]) ?? [];
        break;
      case "orkestrator":
        this.pcOnline = true;
        if ((msg.projectId as string) === this.activeProject?.id) {
          this.applyOrchestrator(msg.msg as Record<string, unknown>);
        }
        break;
    }
  }

  private applyOrchestrator(msg: Record<string, unknown>): void {
    if (msg.kind === "durum") {
      const status = msg.payload as OrchStatus;
      if (status.agents) {
        this.agents = status.agents.map((a) => ({ ...a, status: "bos", task: null }));
      }
      if (status.chat && this.chat.length === 0) {
        this.chat = status.chat;
      }
    } else if (msg.kind === "sef_cevap") {
      this.chat.push({ role: "sef", text: String(msg.text), ts: Date.now() });
    } else if (msg.kind === "event") {
      this.applyEvent(msg.event as FeedEvent);
    }
  }

  private setAgent(name: string, status: AgentStatus, task: string | null): void {
    this.agents = this.agents.map((a) => (a.name === name ? { ...a, status, task } : a));
  }

  private applyEvent(ev: FeedEvent): void {
    ev.uid = ++this.feedSeq;
    this.feed = [ev, ...this.feed].slice(0, 150);
    const p = ev.payload;
    switch (ev.type) {
      case "delege_basladi":
        this.setAgent(String(p.agent), "calisiyor", String(p.task ?? ""));
        break;
      case "peer_istek":
        this.setAgent(String(p.peer), "calisiyor", String(p.request ?? ""));
        break;
      case "delege_bitti":
        this.setAgent(String(p.agent), p.isError ? "hata" : "bos", null);
        break;
      case "worker_spawn":
        this.workers.push({
          id: ++this.workerSeq,
          task: String(p.task ?? `${p.count ?? 1} task(s)`),
          done: false,
          isError: false,
        });
        break;
      case "worker_done": {
        const w = this.workers.find((x) => !x.done);
        if (w) {
          w.done = true;
          w.isError = Boolean(p.isError);
        }
        this.workers = [...this.workers];
        break;
      }
      case "token_guncelleme":
        this.tokensIn += Number(p.input ?? 0);
        this.tokensOut += Number(p.output ?? 0);
        break;
    }
  }
}

export const relay = new Relay();
