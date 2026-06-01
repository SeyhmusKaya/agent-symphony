// Pure helpers for the +page.svelte main router — model/effort lists, agent
// catalog, short format functions. Shared by NavRail + TabBar + +page.

// Fix 104: Opus always 1M context, Sonnet always 200k. The [1m] suffix was
// removed — the backend adds it automatically to the opus model during the SDK
// call. Fast variants were removed — Anthropic does not accept 'fast' as a model
// name (404); the fast tier will be added later as a service_tier parameter in F4.
export const MODELS = [
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-sonnet-4-6",
];

// Task #98/99: xhigh + max levels with Opus 4.8. xhigh = ultracode
// (Anthropic dynamic workflow trigger — hundreds of parallel subagents);
// max = the highest thinking budget.
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function modelShort(m: string): string {
  if (m.includes("deepseek")) return m.includes("pro") ? "DS·V4 Pro" : "DS·V4 Flash";
  if (m.includes("opus-4-8")) return "opus·4.8";
  if (m.includes("opus-4-7")) return "opus·4.7";
  if (m.includes("opus")) return "opus";
  if (m.includes("haiku")) return "haiku";
  if (m.includes("sonnet")) return "sonnet";
  return m;
}

export interface AgentDef {
  key: string;
  name: string;
  port: number;
  mark: string;
  subtitle: string;
  hint: string;
}

// Architect + 11 advisors — ports are fixed (4305-4316). The Architect is
// always the first item (AGENTS[0]); advisors = AGENTS.slice(1).
export const AGENTS: AgentDef[] = [
  { key: "mimar", name: "Architect", port: 4316, mark: "A", subtitle: "Coordinates all projects", hint: "Ask about projects or give orders to a chief." },
  { key: "pazarlama", name: "Marketing Specialist", port: 4310, mark: "P", subtitle: "Marketing Specialist", hint: "Ask about marketing strategy, campaigns, growth." },
  { key: "seo", name: "SEO Analyst", port: 4311, mark: "A", subtitle: "SEO Analyst", hint: "Ask about SEO, keywords, content optimization." },
  { key: "trading", name: "Trading & Finance Analyst", port: 4312, mark: "T", subtitle: "Trading & Finance Analyst", hint: "Ask about market analysis, trading strategy, risk." },
  { key: "sosyal-medya", name: "Social Media Specialist", port: 4313, mark: "S", subtitle: "Social Media Specialist", hint: "Ask about content, platform dynamics, growth tactics." },
  { key: "uxtasarim", name: "UX/Design Specialist", port: 4305, mark: "U", subtitle: "UX/Design Specialist", hint: "Ask about UI, usability, design decisions." },
  { key: "hukuk", name: "Legal & Privacy Advisor", port: 4306, mark: "H", subtitle: "Legal & Privacy Advisor", hint: "Ask about contracts, privacy, legal compliance." },
  { key: "veri", name: "Data Analyst", port: 4307, mark: "V", subtitle: "Data Analyst", hint: "Ask about metrics, A/B tests, data interpretation." },
  { key: "finans", name: "Finance & Accounting Advisor", port: 4308, mark: "F", subtitle: "Finance & Accounting Advisor", hint: "Ask about cost, budget, billing, financial planning." },
  { key: "devops", name: "DevOps & Infrastructure Advisor", port: 4309, mark: "D", subtitle: "DevOps & Infrastructure Advisor", hint: "Ask about deploy, CI/CD, servers, scaling." },
  { key: "siber-guvenlik", name: "Cyber Security Advisor", port: 4315, mark: "C", subtitle: "Cyber Security Advisor", hint: "Ask about OWASP, header/cookie security, pentest, hardening, vulnerability assessment." },
  { key: "urun", name: "Product Manager", port: 4317, mark: "U", subtitle: "Product Manager", hint: "Ask about roadmap, prioritization, PRD, MVP scope, user research." },
  { key: "ai", name: "AI/LLM Engineer", port: 4318, mark: "AI", subtitle: "AI/LLM Engineer", hint: "Ask about prompt engineering, RAG, agent design, evals, model selection." },
  { key: "sunucu", name: "Server & SysAdmin", port: 4319, mark: "Su", subtitle: "Server & System Administrator", hint: "Ask about Linux server admin, nginx/SSL, hardening, backups, server troubleshooting." },
];

export function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  return `${day} d ago`;
}
