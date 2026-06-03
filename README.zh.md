<div align="center">

<img src="docs/img/banner.png" alt="Architect — Agent Symphony" width="100%" />

# Architect — Agent Symphony

### 面向 Claude Agent SDK 的分层多智能体编排器 —— 多供应商（Claude + DeepSeek）

*一位指挥家。一整支 AI 智能体团队。掌控权始终在你手中。*

[![Sponsor](https://img.shields.io/github/sponsors/SeyhmusKaya?style=for-the-badge&logo=githubsponsors&color=ea4aaa)](https://github.com/sponsors/SeyhmusKaya)
[![Stars](https://img.shields.io/github/stars/SeyhmusKaya/agent-symphony?style=for-the-badge&color=f59e0b)](https://github.com/SeyhmusKaya/agent-symphony/stargazers)
[![Release](https://img.shields.io/github/v/release/SeyhmusKaya/agent-symphony?style=for-the-badge&color=8b5cf6)](https://github.com/SeyhmusKaya/agent-symphony/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/SeyhmusKaya/agent-symphony/ci.yml?branch=main&style=for-the-badge&label=build)](https://github.com/SeyhmusKaya/agent-symphony/actions)
[![Last commit](https://img.shields.io/github/last-commit/SeyhmusKaya/agent-symphony?style=for-the-badge&color=10b981)](https://github.com/SeyhmusKaya/agent-symphony/commits/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg?style=for-the-badge)](LICENSE)
[![Built with Claude Agent SDK](https://img.shields.io/badge/Built%20with-Claude%20Agent%20SDK-0F766E?style=for-the-badge)](https://docs.anthropic.com/en/api/agent-sdk)
[![Desktop: Tauri](https://img.shields.io/badge/Desktop-Tauri%20%2B%20SvelteKit-24c8db?style=for-the-badge&logo=tauri)](https://tauri.app)

<br/>

[Türkçe](README.tr.md) · [English](README.md) · **中文** · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt.md) · [Русский](README.ru.md)
</div>

---

## 💜 支持 / 捐赠

**Architect — Agent Symphony 是免费且开源的，由一名独立开发者打造。** 如果它为你节省了时间，或者你只是喜欢这个想法，一笔捐赠就能让这些智能体持续运转、让开发不断推进。谢谢你。🙏

### ⭐ GitHub Sponsors（推荐）
最简单的支持方式 —— 一键完成，可定期或一次性，**0% 平台手续费**（100% 直达作者）：

👉 **[github.com/sponsors/SeyhmusKaya](https://github.com/sponsors/SeyhmusKaya)**

### ₿ 加密货币

| 资产 | 网络 | 地址 |
|-------|---------|---------|
| **USDT** | **TRC20**（Tron） | `TD5DADsYjH3aydsi7zrgDrqVAj3EzWx1Cb` |
| **BTC** | **Bitcoin** | `12W1kc6qvDEwG9QfdjHWtdT2QEKDrTApWm` |
| **ETH** | **ERC20**（Ethereum） | `0x8d0ba54ba688fe70f1f3888ad494817b9fdebc7b` |

> ⚠️ **每种资产只能通过上方所示的网络转账。** 在错误的网络上转账可能导致资金永久丢失。

---

## ✨ 这是什么？

**Architect — Agent Symphony** 是一款桌面应用，它把 Claude Agent SDK 变成 **一个由你像经营一家公司那样编排的、分层的 AI 智能体组织。**

你不再只是与单个助手对话，而是运行 **一张由专业智能体组成的组织架构图**：一位首席架构师协调各个项目主管，每位主管指挥自己的常驻专家、咨询一组领域顾问，并派出一次性工人 —— 全部并行进行，全部在同一个驾驶舱中，具备完整的成本可见性和媲美 Claude Code 级别的上下文管理。

不妨把它想象成 **一支 Claude 智能体团队的任务控制中心** —— 专为编排真实的、跨多个项目的软件工作而打造。

### 🧭 它的定位

如果你用过 **Claude Code**、**CrewAI**、**AutoGen** 或 **LangGraph**：那些是你需要 *编写脚本* 的框架和 CLI。**Architect — Agent Symphony** 则是 **一个让编排 *本身* 成为产品的桌面驾驶舱** —— 你观察并指挥一个跨真实项目的常设智能体组织，享有实时的成本与上下文可见性，而无需编写编排代码。它直接构建在官方 **[Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk)** 之上（进程内运行，无需单独的 CLI），因此你能获得 Claude Code 级别的行为，并在其上叠加一套多智能体、多项目的 UI。

**关键词：** Claude 智能体编排 · DeepSeek 智能体编排 · 多供应商 LLM 智能体 · 多智能体 AI · 智能体工作流 · 自主编码智能体 · Claude Code 替代 UI · DeepSeek V4 桌面应用 · AI 软件团队 · MCP 工具。

---

## 🌟 它的与众不同之处

- 🧬 **每个智能体专属技能** —— 每个智能体加载 **自己的** 技能文件。你打造的是真正具备深厚领域知识的专家，而不是挂着名牌的通用聊天机器人。
- 🤖 **技能按任务自动分配** —— 当主管启动一个新专家时，它会 **自动继承适合该工作的领域技能**：设计专家获得设计技能，安全专家获得安全技能。
- 🗂️ **像浏览器标签页一样浏览项目** —— 像切换 Chrome 标签页那样在多个 **实时项目和并行会话** 之间切换，每个都有自己的智能体、上下文、历史记录和成本计量器。
- 💬 **智能体之间相互沟通** —— 主管咨询顾问并向其他项目主管发消息；工作是 *在智能体之间协商* 完成的，而不仅仅由你自上而下地下达。
- 🌙 **隔夜自我改进** —— 首席 Architect 可以 **每晚分析自己的代码库，并自主提出 / 交付改进**，因此在你睡觉时编排器也在不断变得更好。
- ⚡ **默认并行** —— 相互独立的子任务会一次性分发给众多智能体，随后由指挥家合并结果。

---

## 📸 驾驶舱

<div align="center">
<img src="docs/img/app-screenshot.png" alt="Architect — Agent Symphony desktop cockpit" width="100%" />
</div>

---

## 🎼 交响乐 —— 这套层级如何演奏

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

| 角色 | 它是什么 | 生命周期 |
|------|-----------|----------|
| 🏛️ **Architect** | 指挥家。协调整个生态系统，开发编排器本身，在各主管之间调度工作。 | 始终在线 |
| 👔 **Project Chief** | 每个项目一位。项目的资深工程师 —— 掌管代码、git、ssh/部署。与其他主管沟通。 | 常驻 |
| 🧑‍💻 **Specialist** | 主管的常驻专家（例如 *前端专家*、*后端专家*）。在隔离的并行智能体窗口中编写和修改代码。 | 常驻 |
| 🎓 **Advisor** | 11 位固定的领域专家（设计/UI、SEO、安全、法务、市场、财务、会计、数据、devops、社媒、交易）。提供决策支持 —— 他们不写代码。 | 内置 |
| ⚡ **Worker** | 用于快速探索或单次修改的一次性匿名智能体。 | 临时 |

智能体之间相互沟通（跨智能体消息传递）、并行委派，指挥家再把结果拼接起来 —— 因此你只下达一条指令，整支团队便会执行。

---

## 🚀 功能特性

### 🧠 Claude Code 级别的上下文工程
- **原生 SDK 压缩** —— 上下文会像 Claude Code 那样 *在同一会话内* 被压缩（会话 ID 保持不变），并配有传统的「总结并向前携带」回退机制，使智能体 **永远不会丢失其工作记忆**。
- **按会话、按智能体的 token 与成本追踪** —— 每一轮都会显示新增 / 缓存读取 / 缓存写入的 token，以及精确的美元成本。
- **面向提示缓存的设计** —— 稳定的工具集和缓存友好的提示布局让缓存命中率保持在高位（用廉价的读取代替昂贵的重写）。
- **惰性工具组** —— 智能体按需加载工具集（`load_toolset`），以保持每轮的 token 下限较低。

### 🔀 多供应商模型路由（Claude + DeepSeek）
- **两家供应商，一个驾驶舱** —— 在 **Anthropic Claude**（Opus / Sonnet / Haiku）**或 DeepSeek V4**（`deepseek-v4-pro` / `deepseek-v4-flash`）上运行智能体。可在同一个下拉菜单中为每个智能体选择模型。
- **自动供应商优先级** —— 如果设置了 DeepSeek API 密钥，则优先使用 DeepSeek；否则使用 Anthropic API 密钥；再否则使用你的 Claude Pro/Max 登录。无需改动代码。
- **DeepSeek 上合理的角色默认值** —— 主管、首席架构师和顾问默认使用 **DeepSeek V4 Pro**，一次性专家/工人则使用更便宜的 **DeepSeek V4 Flash**。
- **工作原理** —— DeepSeek 通过其 **Anthropic 兼容端点**（`https://api.deepseek.com/anthropic`）访问，因此相同的 Agent SDK 请求格式、工具调用、思考模式和 1M token 上下文窗口都能原封不动地工作。每个供应商按模型、按 token 的美元成本都会被正确追踪。
- **实时切换** —— 可在会话进行中把正在运行的智能体的模型从 Claude 切换到 DeepSeek（或切回）；路由会在每次请求时跟随所选模型。

### 🕸️ CodeGraph —— 语义化代码智能
一个覆盖你各个仓库的内置代码图谱（由用于 TypeScript、JavaScript、Python、PHP、C#、Dart 和 Svelte 的 **tree-sitter** + **SQLite FTS** + 嵌入向量驱动）：
- `code_search`、`code_node`、`code_callers`、`code_callees`、`code_impact`、`code_imports`、`code_files`、`code_stats`
- 智能体查询图谱，而不是盲目地 grep —— 更快、更便宜、更准确。文件变更时自动重新索引。

### 👥 多智能体编排
- **并行委派** —— 相互独立的子任务在单个批次中分发给多个智能体。
- **常驻专家**，拥有各自的身份、技能和聊天历史。
- **跨智能体通信** —— 主管咨询顾问并相互发消息（`talk_to_chief`）。
- **实时活动视图** —— 点击任何正在工作的专家，即可查看它收到的提示以及它此刻正在做什么。
- **后台委派** —— 派出一个长时间运行的专家，同时继续与主管对话；结果就绪后会回流过来。

### 🗂️ 多项目、多会话驾驶舱
- 管理众多项目，每个都有自己的主管和智能体。
- 每个智能体可有多个并行会话，采用 Claude Code 风格，各自拥有独立的上下文、成本和历史记录。
- 会话 **永远不会被悄无声息地重置** —— 你的上下文能在停止、重启和重试中存续。

### 🛠️ 面向现实的运维工具
- **SSH / 部署** 工具，用于把项目发布到服务器。
- **密钥保险库** 存放凭据（绝不提交）。
- **按角色的技能** —— 把领域 SKILL 文件附加给专家和顾问。
- **自主模式** —— 把一个跨多日的目标交给智能体，让它自行工作，可暂停和恢复。
- 通过 Playwright 实现 **浏览器自动化与图像生成**。
- **预算控制**，在达到上限时自动回退到更便宜的模型。

### 🎨 一款真正出色的桌面应用
使用 **Tauri + SvelteKit** 构建 —— 一个快速的原生桌面驾驶舱（而非浏览器标签页），拥有干净、定制设计的深色 UI：渐变标题栏、卡片式智能体列表、实时 token 仪表、CodeGraph 浏览器、报告和笔记。

---

## 🧩 技术栈

| 层 | 技术 |
|-------|------|
| **智能体** | [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk)（进程内） |
| **模型供应商** | Anthropic Claude（Opus / Sonnet / Haiku）· DeepSeek V4（Pro / Flash），经由 Anthropic 兼容端点 |
| **后端** | 运行于 `tsx` 的 TypeScript、WebSocket（`ws`）、Zod |
| **代码智能** | tree-sitter（7 种语言）+ `better-sqlite3`（FTS）+ 嵌入向量 |
| **自动化** | Playwright / Patchright |
| **桌面 UI** | Tauri（Rust）+ SvelteKit |

---

## 📦 快速开始

> **状态：** 作者 **每天都在生产环境中实际使用** 它来运行真实的、跨多个项目的软件工作 —— 这不是演示，也不是弃坑软件。它目前在 Windows 上运行，属于面向高级用户的软件（请预期会需要阅读一些代码）。**它正在被积极维护，并将持续改进 —— 只要有人感兴趣，开发就会继续。** 提交一个 [issue](https://github.com/SeyhmusKaya/agent-symphony/issues) 说说你想要什么，或者 [赞助](https://github.com/sponsors/SeyhmusKaya) 来帮助塑造路线图。

### 前置要求
- **Node.js 20+**
- **Claude 访问权限** —— 需要 **Claude Pro / Max 订阅** *或* **Anthropic API 密钥**。参见下方的 [身份验证](#-authentication--works-with-your-claude-plan-or-an-api-key)。
- 桌面构建需要：[Tauri 前置要求](https://tauri.app/start/prerequisites/)（Rust 工具链）

### 运行编排器（后端）
```bash
git clone https://github.com/SeyhmusKaya/agent-symphony.git
cd agent-symphony
npm install

# copy the secrets template and fill in what you need (optional: ssh/deploy/relay)
cp secrets.local.json.example secrets.local.json

# start the orchestrator
npm start          # or: npm run dev   (tsx watch, auto-reload)
```

### 运行桌面 UI
```bash
cd ui
npm install
npm run tauri dev   # dev mode
# or: npm run tauri build   # produces a native desktop binary
```

### 类型检查
```bash
npm run typecheck          # backend
cd ui && npm run check     # UI (svelte-check)
```

---

## 🔑 身份验证 —— Claude 套餐、Anthropic 密钥，*或* DeepSeek 密钥

Architect — Agent Symphony 运行在官方 **Claude Agent SDK** 之上，并支持 **两家模型供应商**。它按以下优先级顺序选择供应商：

- 🟣 **DeepSeek API 密钥** *（设置后优先级最高）* —— 在应用内的 **API keys** 面板中添加你的 DeepSeek 密钥（本地保存在 `providers.json` 中，绝不提交）。随后智能体便会通过 DeepSeek 的 Anthropic 兼容端点运行在 **DeepSeek V4 Pro / Flash** 上。这是最便宜的路径；如果你同时拥有 Claude 登录，Claude 模型仍会保留在下拉菜单中。
- 🟢 **Claude Pro / Max 订阅** *（推荐给 Claude 用户）* —— 使用 Claude CLI 登录一次（`claude login`）。用量计入你现有的 **Pro/Max 配额 —— 无需 API 密钥，无按 token 计费。**
- 🔵 **Anthropic API 密钥** *（按 token 付费）* —— 设置 `ANTHROPIC_API_KEY`。最适合使用 Console 计费的团队/自动化场景。

> ⚠️ 如果你的环境中设置了 `ANTHROPIC_API_KEY`，它会 **优先于** 你的 Claude 订阅。若要在 Claude 模型上使用你的 Pro/Max 套餐，请保持该变量未设置（并以 Pro/Max 账户运行 `claude logout` → `claude login`）。DeepSeek 密钥在应用内单独管理，仅影响 DeepSeek 模型的请求。

应用的本地代理只优化提示缓存 —— 它 **从不接触你的凭据或 OAuth 刷新路径**，因此两种验证方式都开箱即用。

---

## ⚙️ 配置

- **身份验证** —— 一个 DeepSeek 密钥（应用内）、一次 Claude Pro/Max 登录，*或* `ANTHROPIC_API_KEY`（参见 [身份验证](#-authentication--claude-plan-anthropic-key-or-deepseek-key)）。
- **`secrets.local.json`** —— 可选的 SSH / web 验证 / 中继凭据（被 git 忽略，绝不提交）。参见 `secrets.local.json.example`。
- **功能开关**（环境变量）—— 切换可选子系统，例如长 TTL 提示缓存、异步委派和原生压缩。

> `.github/`、`.team/` 和运行时数据目录都被 git 忽略 —— 凭据或会话数据绝不会被提交。

---

## 🗺️ 路线图

- 跨平台桌面构建（macOS / Linux）
- ✅ 可插拔模型供应商 —— **DeepSeek V4 已交付**；更多供应商即将到来
- 更丰富的自主模式控制
- 更多 CodeGraph 语言

有想法吗？[提交一个 issue](https://github.com/SeyhmusKaya/agent-symphony/issues)，或者，如果它对你有帮助，考虑 [赞助](https://github.com/sponsors/SeyhmusKaya) 💜。

---

## 📄 许可证

[MIT](LICENSE) © Şeyhmus Kaya

---

<div align="center">

**如果 Architect — Agent Symphony 对你有用，一个 ⭐ 和一次 [赞助](https://github.com/sponsors/SeyhmusKaya) 都意义非凡。**

由一名开发者用心打造、亲自指挥。

</div>
