<div align="center">

<img src="docs/img/banner.png" alt="Architect — Agent Symphony" width="100%" />

# Architect — Agent Symphony

### A hierarchical multi-agent orchestrator for the Claude Agent SDK — multi-provider (Claude + DeepSeek)

*One conductor. A company of AI agents. You stay in command.*

[![Sponsor](https://img.shields.io/github/sponsors/SeyhmusKaya?style=for-the-badge&logo=githubsponsors&color=ea4aaa)](https://github.com/sponsors/SeyhmusKaya)
[![Stars](https://img.shields.io/github/stars/SeyhmusKaya/agent-symphony?style=for-the-badge&color=f59e0b)](https://github.com/SeyhmusKaya/agent-symphony/stargazers)
[![Release](https://img.shields.io/github/v/release/SeyhmusKaya/agent-symphony?style=for-the-badge&color=8b5cf6)](https://github.com/SeyhmusKaya/agent-symphony/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/SeyhmusKaya/agent-symphony/ci.yml?branch=main&style=for-the-badge&label=build)](https://github.com/SeyhmusKaya/agent-symphony/actions)
[![Last commit](https://img.shields.io/github/last-commit/SeyhmusKaya/agent-symphony?style=for-the-badge&color=10b981)](https://github.com/SeyhmusKaya/agent-symphony/commits/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg?style=for-the-badge)](LICENSE)
[![Built with Claude Agent SDK](https://img.shields.io/badge/Built%20with-Claude%20Agent%20SDK-0F766E?style=for-the-badge)](https://docs.anthropic.com/en/api/agent-sdk)
[![Desktop: Tauri](https://img.shields.io/badge/Desktop-Tauri%20%2B%20SvelteKit-24c8db?style=for-the-badge&logo=tauri)](https://tauri.app)

<br/>

[Türkçe](README.tr.md) · **English** · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt.md)

</div>

---

## 💜 Support / Donate

**Architect — Agent Symphony is free and open source, built by a solo developer.** If it saves you time or you simply like the idea, a donation keeps the agents running and development moving. Thank you. 🙏

### ⭐ GitHub Sponsors (recommended)
The easiest way to support — one click, recurring or one-time, **0% platform fee** (100% reaches the author):

👉 **[github.com/sponsors/SeyhmusKaya](https://github.com/sponsors/SeyhmusKaya)**

### ₿ Crypto

| Asset | Network | Address |
|-------|---------|---------|
| **USDT** | **TRC20** (Tron) | `TD5DADsYjH3aydsi7zrgDrqVAj3EzWx1Cb` |
| **BTC** | **Bitcoin** | `12W1kc6qvDEwG9QfdjHWtdT2QEKDrTApWm` |
| **ETH** | **ERC20** (Ethereum) | `0x8d0ba54ba688fe70f1f3888ad494817b9fdebc7b` |

> ⚠️ **Send each asset only on the network shown above.** Sending on the wrong network may permanently lose the funds.

---

## ✨ What is this?

**Architect — Agent Symphony** is a desktop application that turns the Claude Agent SDK into a **hierarchical organization of AI agents you orchestrate like a company.**

Instead of chatting with a single assistant, you run an **org chart of specialized agents**: a head architect coordinates project chiefs, each chief commands its own persistent specialists, consults a panel of domain advisors, and dispatches one-shot workers — all in parallel, all in one cockpit, with full cost visibility and Claude-Code-grade context management.

Think of it as **mission control for a team of Claude agents** — purpose-built for orchestrating real, multi-project software work.

### 🧭 Where it fits

If you've used **Claude Code**, **CrewAI**, **AutoGen**, or **LangGraph**: those are frameworks and CLIs you *script*. **Architect — Agent Symphony** is a **desktop cockpit where the orchestration *is* the product** — you watch and command a standing organization of agents across real projects, with live cost and context visibility, instead of writing orchestration code. It's built directly on the official **[Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk)** (in-process, no separate CLI), so you get Claude-Code-grade behavior with a multi-agent, multi-project UI on top.

**Keywords:** Claude agent orchestration · DeepSeek agent orchestration · multi-provider LLM agents · multi-agent AI · agentic workflows · autonomous coding agents · Claude Code alternative UI · DeepSeek V4 desktop app · AI software team · MCP tools.

---

## 🌟 What makes it different

- 🧬 **Per-agent skills** — every agent loads its **own** skill files. You build a real specialist with deep domain knowledge, not a generic chatbot wearing a name tag.
- 🤖 **Skills auto-assigned by task** — when a chief spins up a new specialist, it **automatically inherits the right domain skills** for the job: a design specialist gets the design skills, a security one gets the security skills.
- 🗂️ **Browse projects like browser tabs** — flip between multiple **live projects and parallel sessions** like Chrome tabs, each with its own agents, context, history and cost meter.
- 💬 **Agents talk to each other** — chiefs consult the advisors and message other project chiefs; work is *negotiated between agents*, not just dictated top-down by you.
- 🌙 **Self-improving overnight** — the head Architect can **analyze its own codebase every night and propose / ship improvements autonomously**, so the orchestrator keeps getting better while you sleep.
- ⚡ **Parallel by default** — independent subtasks fan out to many agents at once, then the conductor merges the results.

---

## 📸 The cockpit

<div align="center">
<img src="docs/img/app-screenshot.png" alt="Architect — Agent Symphony desktop cockpit" width="100%" />
</div>

---

## 🎼 The Symphony — how the hierarchy plays

<div align="center">
<img src="docs/img/architecture.png" alt="Architecture: Architect → Project Chiefs → Specialists / Workers, with a panel of Advisors" width="92%" />
</div>

```
                        🏛️  ARCHITECT  (the conductor)
                        coordinates everything, owns the ecosystem
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
   👔 PROJECT CHIEF             👔 PROJECT CHIEF              🎓 ADVISORS (11, fixed)
   owns one project            owns another project          domain decision support
   git · ssh · deploy          git · ssh · deploy            design · SEO · security
        │                             │                       legal · finance · data
        ├── 🧑‍💻 Specialist          ├── 🧑‍💻 Specialist        devops · marketing · …
        ├── 🧑‍💻 Specialist          └── ⚡ Worker (one-shot)   (consulted on demand)
        └── ⚡ Worker (one-shot)
```

| Role | What it is | Lifetime |
|------|-----------|----------|
| 🏛️ **Architect** | The conductor. Coordinates the whole ecosystem, develops the orchestrator itself, routes work between chiefs. | Always on |
| 👔 **Project Chief** | One per project. The project's senior engineer — owns the code, git, ssh/deploy. Talks to other chiefs. | Persistent |
| 🧑‍💻 **Specialist** | A chief's persistent expert (e.g. *Frontend Specialist*, *Backend Specialist*). Writes & edits code in an isolated parallel agent window. | Persistent |
| 🎓 **Advisor** | 11 fixed domain experts (design/UI, SEO, security, legal, marketing, finance, accounting, data, devops, social, trading). Decision support — they don't write code. | Built-in |
| ⚡ **Worker** | A one-shot anonymous agent for quick exploration or a single edit. | Ephemeral |

Agents talk to each other (cross-agent messaging), delegate in parallel, and the conductor stitches the results together — so you give one instruction and a whole team executes.

---

## 🚀 Features

### 🧠 Claude-Code-grade context engineering
- **Native SDK compaction** — context is compacted *inside the same session* (session ID preserved) the way Claude Code does it, with a legacy summarize-and-carry-forward fallback so an agent **never loses its working memory**.
- **Per-session, per-agent token & cost tracking** — every turn shows fresh / cache-read / cache-write tokens and the exact USD cost.
- **Prompt-cache-aware design** — stable tool sets and cache-friendly prompt layout keep cache hit rates high (cheap reads instead of expensive rewrites).
- **Lazy tool groups** — agents load tool sets on demand (`load_toolset`) to keep the per-turn token floor low.

### 🔀 Multi-provider model routing (Claude + DeepSeek)
- **Two providers, one cockpit** — run agents on **Anthropic Claude** (Opus / Sonnet / Haiku) **or DeepSeek V4** (`deepseek-v4-pro` / `deepseek-v4-flash`). Pick the model per agent from the same dropdown.
- **Automatic provider priority** — if a DeepSeek API key is set, DeepSeek is used first; otherwise an Anthropic API key; otherwise your Claude Pro/Max login. No code changes.
- **Sensible role defaults on DeepSeek** — chiefs, the head architect and advisors default to **DeepSeek V4 Pro**, one-shot specialists/workers to the cheaper **DeepSeek V4 Flash**.
- **How it works** — DeepSeek is reached through its **Anthropic-compatible endpoint** (`https://api.deepseek.com/anthropic`), so the same Agent-SDK request format, tool calls, thinking mode and 1M-token context window work unchanged. Per-model, per-token USD cost is tracked correctly for each provider.
- **Switch live** — change a running agent's model from Claude to DeepSeek (or back) mid-session; routing follows the selected model on every request.

### 🕸️ CodeGraph — semantic code intelligence
A built-in code graph over your repos (powered by **tree-sitter** for TypeScript, JavaScript, Python, PHP, C#, Dart & Svelte + **SQLite FTS** + embeddings):
- `code_search`, `code_node`, `code_callers`, `code_callees`, `code_impact`, `code_imports`, `code_files`, `code_stats`
- Agents query the graph instead of blindly grepping — faster, cheaper, more accurate. Auto-reindexes on file changes.

### 👥 Multi-agent orchestration
- **Parallel delegation** — independent subtasks fan out to multiple agents in a single batch.
- **Persistent specialists** with their own identity, skills and chat history.
- **Cross-agent communication** — chiefs consult advisors and message each other (`talk_to_chief`).
- **Live activity view** — click any working specialist to see the prompt it received and what it's doing right now.
- **Background delegation** — fire off a long-running specialist and keep chatting with the chief; results flow back when ready.

### 🗂️ Multi-project, multi-session cockpit
- Manage many projects, each with its own chief and agents.
- Multiple parallel sessions per agent, Claude-Code-style, each with its own context, cost and history.
- Sessions are **never silently reset** — your context survives stops, restarts and retries.

### 🛠️ Real-world operator tools
- **SSH / deploy** tools for shipping projects to servers.
- **Secret vault** for credentials (never committed).
- **Per-role skills** — attach domain SKILL files to specialists and advisors.
- **Autonomous mode** — hand an agent a multi-day goal and let it work, pause and resume.
- **Browser automation & image generation** via Playwright.
- **Budget control** with automatic fallback to a cheaper model when a cap is hit.

### 🎨 A genuinely nice desktop app
Built with **Tauri + SvelteKit** — a fast, native desktop cockpit (not a browser tab) with a clean, custom-designed dark UI: gradient headers, card-based agent lists, live token gauges, a CodeGraph explorer, reports and notes.

---

## 🧩 Tech stack

| Layer | Tech |
|-------|------|
| **Agents** | [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk) (in-process) |
| **Model providers** | Anthropic Claude (Opus / Sonnet / Haiku) · DeepSeek V4 (Pro / Flash) via the Anthropic-compatible endpoint |
| **Backend** | TypeScript on `tsx`, WebSocket (`ws`), Zod |
| **Code intelligence** | tree-sitter (7 languages) + `better-sqlite3` (FTS) + embeddings |
| **Automation** | Playwright / Patchright |
| **Desktop UI** | Tauri (Rust) + SvelteKit |

---

## 📦 Getting started

> **Status:** **Actively used in production every day** by the author to run real, multi-project software work — this is not a demo or abandonware. It runs on Windows today and is power-user software (expect to read some code). **It is actively maintained and will keep being improved — if there's interest, development continues.** Open an [issue](https://github.com/SeyhmusKaya/agent-symphony/issues) with what you'd want, or [sponsor](https://github.com/sponsors/SeyhmusKaya) to help shape the roadmap.

### Prerequisites
- **Node.js 20+**
- **Claude access** — either a **Claude Pro / Max subscription** *or* an **Anthropic API key**. See [Authentication](#-authentication--works-with-your-claude-plan-or-an-api-key) below.
- For the desktop build: the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (Rust toolchain)

### Run the orchestrator (backend)
```bash
git clone https://github.com/SeyhmusKaya/agent-symphony.git
cd agent-symphony
npm install

# copy the secrets template and fill in what you need (optional: ssh/deploy/relay)
cp secrets.local.json.example secrets.local.json

# start the orchestrator
npm start          # or: npm run dev   (tsx watch, auto-reload)
```

### Run the desktop UI
```bash
cd ui
npm install
npm run tauri dev   # dev mode
# or: npm run tauri build   # produces a native desktop binary
```

### Type-check
```bash
npm run typecheck          # backend
cd ui && npm run check     # UI (svelte-check)
```

---

## 🔑 Authentication — Claude plan, Anthropic key, *or* DeepSeek key

Architect — Agent Symphony runs on the official **Claude Agent SDK** and supports **two model providers**. It picks a provider in this priority order:

- 🟣 **DeepSeek API key** *(highest priority when set)* — add your DeepSeek key in the in-app **API keys** panel (stored locally in `providers.json`, never committed). Agents then run on **DeepSeek V4 Pro / Flash** through DeepSeek's Anthropic-compatible endpoint. Cheapest path; Claude models stay available in the dropdown if you also have a Claude login.
- 🟢 **Claude Pro / Max subscription** *(recommended for Claude users)* — log in once with the Claude CLI (`claude login`). Usage counts against your existing **Pro/Max quota — no API key, no per-token bill.**
- 🔵 **Anthropic API key** *(pay-per-token)* — set `ANTHROPIC_API_KEY`. Best for teams/automation with Console billing.

> ⚠️ If `ANTHROPIC_API_KEY` is set in your environment, it **takes precedence** over your Claude subscription. To use your Pro/Max plan for Claude models, leave that variable unset (and run `claude logout` → `claude login` with the Pro/Max account). The DeepSeek key is managed separately in-app and only affects DeepSeek-model requests.

The app's local proxy only optimizes prompt caching — it **never touches your credentials or the OAuth refresh path**, so both auth modes work out of the box.

---

## ⚙️ Configuration

- **Auth** — a DeepSeek key (in-app), a Claude Pro/Max login, *or* `ANTHROPIC_API_KEY` (see [Authentication](#-authentication--claude-plan-anthropic-key-or-deepseek-key)).
- **`secrets.local.json`** — optional SSH / web-auth / relay credentials (git-ignored, never committed). See `secrets.local.json.example`.
- **Feature flags** (environment variables) — toggle optional subsystems such as long-TTL prompt cache, async delegation and native compaction.

> The `.github/`, `.team/` and runtime data directories are git-ignored — no credentials or session data are ever committed.

---

## 🗺️ Roadmap

- Cross-platform desktop builds (macOS / Linux)
- ✅ Pluggable model providers — **DeepSeek V4 shipped**; more providers coming
- Richer autonomous-mode controls
- More CodeGraph languages

Have an idea? [Open an issue](https://github.com/SeyhmusKaya/agent-symphony/issues) or, if it helps you, consider [sponsoring](https://github.com/sponsors/SeyhmusKaya) 💜.

---

## 📄 License

[MIT](LICENSE) © Şeyhmus Kaya

---

<div align="center">

**If Architect — Agent Symphony is useful to you, a ⭐ and a [sponsorship](https://github.com/sponsors/SeyhmusKaya) go a long way.**

Made with care, conducted by one developer.

</div>
