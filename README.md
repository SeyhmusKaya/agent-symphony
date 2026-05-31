<div align="center">

<img src="docs/img/banner.png" alt="Architect — Agent Symphony" width="100%" />

# Architect — Agent Symphony

### A hierarchical multi-agent orchestrator for the Claude Agent SDK

*One conductor. A company of AI agents. You stay in command.*

[![Sponsor](https://img.shields.io/github/sponsors/SeyhmusKaya?style=for-the-badge&logo=githubsponsors&color=ea4aaa)](https://github.com/sponsors/SeyhmusKaya)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg?style=for-the-badge)](LICENSE)
[![Built with Claude Agent SDK](https://img.shields.io/badge/Built%20with-Claude%20Agent%20SDK-0F766E?style=for-the-badge)](https://docs.anthropic.com/en/api/agent-sdk)
[![Desktop: Tauri](https://img.shields.io/badge/Desktop-Tauri%20%2B%20SvelteKit-24c8db?style=for-the-badge&logo=tauri)](https://tauri.app)

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
| **Agents** | [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk) (in-process), Anthropic Claude (Opus / Sonnet / Haiku) |
| **Backend** | TypeScript on `tsx`, WebSocket (`ws`), Zod |
| **Code intelligence** | tree-sitter (7 languages) + `better-sqlite3` (FTS) + embeddings |
| **Automation** | Playwright / Patchright |
| **Desktop UI** | Tauri (Rust) + SvelteKit |

---

## 📦 Getting started

> **Status:** This is an actively developed project, originally built for the author's own multi-project workflow and now open-sourced. It runs on Windows today; treat it as power-user software — expect to read some code.

### Prerequisites
- **Node.js 20+**
- An **Anthropic API key** (set `ANTHROPIC_API_KEY` in your environment)
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

## ⚙️ Configuration

- **`ANTHROPIC_API_KEY`** — required, your Anthropic key.
- **`secrets.local.json`** — optional SSH / web-auth / relay credentials (git-ignored, never committed). See `secrets.local.json.example`.
- **Feature flags** (environment variables) — toggle optional subsystems such as long-TTL prompt cache, async delegation and native compaction.

> The `.github/`, `.team/` and runtime data directories are git-ignored — no credentials or session data are ever committed.

---

## 🗺️ Roadmap

- Cross-platform desktop builds (macOS / Linux)
- Pluggable model providers
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
