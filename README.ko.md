<div align="center">

<img src="docs/img/banner.png" alt="Architect — Agent Symphony" width="100%" />

# Architect — Agent Symphony

### Claude Agent SDK를 위한 계층형 멀티 에이전트 오케스트레이터 — 멀티 프로바이더 (Claude + DeepSeek)

*지휘자는 하나. AI 에이전트로 이루어진 회사 조직. 명령권은 당신에게.*

[![Sponsor](https://img.shields.io/github/sponsors/SeyhmusKaya?style=for-the-badge&logo=githubsponsors&color=ea4aaa)](https://github.com/sponsors/SeyhmusKaya)
[![Stars](https://img.shields.io/github/stars/SeyhmusKaya/agent-symphony?style=for-the-badge&color=f59e0b)](https://github.com/SeyhmusKaya/agent-symphony/stargazers)
[![Release](https://img.shields.io/github/v/release/SeyhmusKaya/agent-symphony?style=for-the-badge&color=8b5cf6)](https://github.com/SeyhmusKaya/agent-symphony/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/SeyhmusKaya/agent-symphony/ci.yml?branch=main&style=for-the-badge&label=build)](https://github.com/SeyhmusKaya/agent-symphony/actions)
[![Last commit](https://img.shields.io/github/last-commit/SeyhmusKaya/agent-symphony?style=for-the-badge&color=10b981)](https://github.com/SeyhmusKaya/agent-symphony/commits/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg?style=for-the-badge)](LICENSE)
[![Built with Claude Agent SDK](https://img.shields.io/badge/Built%20with-Claude%20Agent%20SDK-0F766E?style=for-the-badge)](https://docs.anthropic.com/en/api/agent-sdk)
[![Desktop: Tauri](https://img.shields.io/badge/Desktop-Tauri%20%2B%20SvelteKit-24c8db?style=for-the-badge&logo=tauri)](https://tauri.app)

<br/>

[Türkçe](README.tr.md) · [English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · **한국어** · [Español](README.es.md) · [Português](README.pt.md) · [Русский](README.ru.md)
</div>

---

## 💜 후원 / 기부

**Architect — Agent Symphony는 1인 개발자가 만든 무료 오픈 소스 프로젝트입니다.** 이 프로젝트가 당신의 시간을 절약해 주거나 단순히 그 아이디어가 마음에 든다면, 후원은 에이전트가 계속 돌아가고 개발이 이어지도록 합니다. 감사합니다. 🙏

### ⭐ GitHub Sponsors (추천)
가장 쉬운 후원 방법 — 한 번의 클릭, 정기 또는 일회성, **플랫폼 수수료 0%** (100%가 저작자에게 전달됩니다):

👉 **[github.com/sponsors/SeyhmusKaya](https://github.com/sponsors/SeyhmusKaya)**

### ₿ 암호화폐

| 자산 | 네트워크 | 주소 |
|-------|---------|---------|
| **USDT** | **TRC20** (Tron) | `TD5DADsYjH3aydsi7zrgDrqVAj3EzWx1Cb` |
| **BTC** | **Bitcoin** | `12W1kc6qvDEwG9QfdjHWtdT2QEKDrTApWm` |
| **ETH** | **ERC20** (Ethereum) | `0x8d0ba54ba688fe70f1f3888ad494817b9fdebc7b` |

> ⚠️ **각 자산은 반드시 위에 표시된 네트워크로만 전송하세요.** 잘못된 네트워크로 전송하면 자금을 영구적으로 잃을 수 있습니다.

---

## ✨ 이게 뭔가요?

**Architect — Agent Symphony**는 Claude Agent SDK를 **회사처럼 오케스트레이션하는 AI 에이전트의 계층형 조직**으로 바꿔 주는 데스크톱 애플리케이션입니다.

단일 어시스턴트와 대화하는 대신, 당신은 **전문화된 에이전트들의 조직도**를 운영합니다: 수석 아키텍트가 프로젝트 책임자들을 조율하고, 각 책임자는 자신의 영속적인 전문가들을 지휘하며, 도메인 자문단으로 구성된 패널에 의견을 구하고, 일회성 워커를 파견합니다 — 이 모든 것이 병렬로, 하나의 콕핏 안에서, 완전한 비용 가시성과 Claude Code 수준의 컨텍스트 관리와 함께 이루어집니다.

이를 **Claude 에이전트 팀을 위한 미션 컨트롤**이라고 생각해 보세요 — 실제의 멀티 프로젝트 소프트웨어 작업을 오케스트레이션하기 위해 특별히 설계되었습니다.

### 🧭 어디에 적합한가

**Claude Code**, **CrewAI**, **AutoGen**, 또는 **LangGraph**를 사용해 본 적이 있다면: 그것들은 당신이 *스크립트로 작성하는* 프레임워크와 CLI입니다. **Architect — Agent Symphony**는 **오케스트레이션 그 자체가 제품인 데스크톱 콕핏**입니다 — 오케스트레이션 코드를 작성하는 대신, 실제 프로젝트 전반에 걸쳐 상시 가동되는 에이전트 조직을 라이브 비용 및 컨텍스트 가시성과 함께 지켜보고 명령합니다. 이것은 공식 **[Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk)** (인프로세스, 별도의 CLI 없음) 위에 직접 구축되어 있어, 멀티 에이전트, 멀티 프로젝트 UI를 얹은 Claude Code 수준의 동작을 얻을 수 있습니다.

**키워드:** Claude 에이전트 오케스트레이션 · DeepSeek 에이전트 오케스트레이션 · 멀티 프로바이더 LLM 에이전트 · 멀티 에이전트 AI · 에이전틱 워크플로우 · 자율 코딩 에이전트 · Claude Code 대안 UI · DeepSeek V4 데스크톱 앱 · AI 소프트웨어 팀 · MCP 도구.

---

## 🌟 무엇이 다른가

- 🧬 **에이전트별 스킬** — 모든 에이전트는 **자신만의** 스킬 파일을 불러옵니다. 이름표만 단 일반적인 챗봇이 아니라, 깊은 도메인 지식을 갖춘 진짜 전문가를 만듭니다.
- 🤖 **작업에 따라 자동 배정되는 스킬** — 책임자가 새 전문가를 투입할 때, 그 일에 맞는 **적절한 도메인 스킬을 자동으로 상속받습니다**: 디자인 전문가는 디자인 스킬을, 보안 전문가는 보안 스킬을 받습니다.
- 🗂️ **브라우저 탭처럼 프로젝트 탐색** — Chrome 탭처럼 여러 **라이브 프로젝트와 병렬 세션** 사이를 넘나들며, 각각 자신만의 에이전트, 컨텍스트, 히스토리, 비용 미터를 가집니다.
- 💬 **에이전트끼리 대화** — 책임자는 자문단에게 의견을 구하고 다른 프로젝트 책임자에게 메시지를 보냅니다; 작업은 당신이 위에서 일방적으로 지시하는 것이 아니라 *에이전트들 사이에서 협의됩니다*.
- 🌙 **밤사이 자가 개선** — 수석 Architect는 **매일 밤 자신의 코드베이스를 분석하고 개선을 제안 / 배포하는 작업을 자율적으로** 수행할 수 있어, 당신이 자는 동안에도 오케스트레이터가 계속 더 나아집니다.
- ⚡ **기본값이 병렬** — 독립적인 하위 작업은 한 번에 여러 에이전트로 분산되고, 그 후 지휘자가 결과를 병합합니다.

---

## 📸 콕핏

<div align="center">
<img src="docs/img/app-screenshot.png" alt="Architect — Agent Symphony desktop cockpit" width="100%" />
</div>

---

## 🎼 심포니 — 계층 구조가 연주되는 방식

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

| 역할 | 무엇인가 | 수명 |
|------|-----------|----------|
| 🏛️ **Architect** | 지휘자. 생태계 전체를 조율하고, 오케스트레이터 자체를 개발하며, 책임자들 사이에서 작업을 라우팅합니다. | 항상 가동 |
| 👔 **Project Chief** | 프로젝트당 한 명. 프로젝트의 시니어 엔지니어 — 코드, git, ssh/배포를 담당합니다. 다른 책임자들과 대화합니다. | 영속적 |
| 🧑‍💻 **Specialist** | 책임자의 영속적인 전문가 (예: *Frontend Specialist*, *Backend Specialist*). 격리된 병렬 에이전트 창에서 코드를 작성하고 편집합니다. | 영속적 |
| 🎓 **Advisor** | 11명의 고정 도메인 전문가 (디자인/UI, SEO, 보안, 법률, 마케팅, 재무, 회계, 데이터, devops, 소셜, 트레이딩). 의사 결정 지원 — 코드를 작성하지 않습니다. | 내장 |
| ⚡ **Worker** | 빠른 탐색이나 단일 편집을 위한 일회성 익명 에이전트. | 일시적 |

에이전트들은 서로 대화하고(에이전트 간 메시징), 병렬로 위임하며, 지휘자가 결과를 하나로 엮습니다 — 그래서 당신이 하나의 지시를 내리면 팀 전체가 실행합니다.

---

## 🚀 기능

### 🧠 Claude Code 수준의 컨텍스트 엔지니어링
- **네이티브 SDK 컴팩션** — 컨텍스트는 Claude Code가 하는 방식대로 *동일한 세션 내에서* 컴팩션되며(세션 ID 유지), 레거시 요약-후-이월 폴백이 있어 에이전트가 **작업 기억을 결코 잃지 않습니다**.
- **세션별, 에이전트별 토큰 및 비용 추적** — 매 턴마다 fresh / cache-read / cache-write 토큰과 정확한 USD 비용을 보여줍니다.
- **프롬프트 캐시 인지 설계** — 안정적인 도구 세트와 캐시 친화적인 프롬프트 레이아웃이 캐시 히트율을 높게 유지합니다(비싼 재작성 대신 저렴한 읽기).
- **지연 도구 그룹** — 에이전트는 도구 세트를 필요할 때 불러와(`load_toolset`) 턴당 토큰 하한을 낮게 유지합니다.

### 🔀 멀티 프로바이더 모델 라우팅 (Claude + DeepSeek)
- **두 개의 프로바이더, 하나의 콕핏** — 에이전트를 **Anthropic Claude** (Opus / Sonnet / Haiku) **또는 DeepSeek V4** (`deepseek-v4-pro` / `deepseek-v4-flash`)에서 실행합니다. 동일한 드롭다운에서 에이전트마다 모델을 선택하세요.
- **자동 프로바이더 우선순위** — DeepSeek API 키가 설정되어 있으면 DeepSeek가 먼저 사용되고; 그렇지 않으면 Anthropic API 키; 그것도 없으면 당신의 Claude Pro/Max 로그인이 사용됩니다. 코드 변경은 없습니다.
- **DeepSeek에서의 합리적인 역할 기본값** — 책임자, 수석 아키텍트, 자문단은 기본으로 **DeepSeek V4 Pro**를, 일회성 전문가/워커는 더 저렴한 **DeepSeek V4 Flash**를 사용합니다.
- **작동 방식** — DeepSeek는 **Anthropic 호환 엔드포인트**(`https://api.deepseek.com/anthropic`)를 통해 접근하므로, 동일한 Agent SDK 요청 형식, 도구 호출, thinking 모드, 1M 토큰 컨텍스트 윈도우가 변경 없이 작동합니다. 모델별, 토큰별 USD 비용이 각 프로바이더에 대해 정확하게 추적됩니다.
- **실시간 전환** — 실행 중인 에이전트의 모델을 세션 도중에 Claude에서 DeepSeek로(또는 그 반대로) 변경할 수 있습니다; 라우팅은 매 요청마다 선택된 모델을 따릅니다.

### 🕸️ CodeGraph — 시맨틱 코드 인텔리전스
당신의 저장소 위에 구축된 내장 코드 그래프 (TypeScript, JavaScript, Python, PHP, C#, Dart, Svelte를 위한 **tree-sitter** + **SQLite FTS** + 임베딩 기반):
- `code_search`, `code_node`, `code_callers`, `code_callees`, `code_impact`, `code_imports`, `code_files`, `code_stats`
- 에이전트는 무작정 grep 하는 대신 그래프를 쿼리합니다 — 더 빠르고, 더 저렴하고, 더 정확합니다. 파일이 변경되면 자동으로 재인덱싱됩니다.

### 👥 멀티 에이전트 오케스트레이션
- **병렬 위임** — 독립적인 하위 작업이 단일 배치로 여러 에이전트에 분산됩니다.
- 자신만의 정체성, 스킬, 채팅 히스토리를 가진 **영속적인 전문가**.
- **에이전트 간 통신** — 책임자는 자문단에게 의견을 구하고 서로에게 메시지를 보냅니다(`talk_to_chief`).
- **라이브 활동 뷰** — 작업 중인 전문가를 클릭하면 그가 받은 프롬프트와 지금 무엇을 하고 있는지 볼 수 있습니다.
- **백그라운드 위임** — 오래 걸리는 전문가를 띄워 놓고 책임자와 계속 대화하세요; 준비되면 결과가 다시 흘러 들어옵니다.

### 🗂️ 멀티 프로젝트, 멀티 세션 콕핏
- 각각 자신만의 책임자와 에이전트를 가진 여러 프로젝트를 관리합니다.
- 에이전트당 여러 병렬 세션을 Claude Code 스타일로, 각각 자신만의 컨텍스트, 비용, 히스토리와 함께 운영합니다.
- 세션은 **조용히 리셋되는 일이 결코 없습니다** — 당신의 컨텍스트는 중지, 재시작, 재시도를 거쳐도 살아남습니다.

### 🛠️ 실전용 오퍼레이터 도구
- 프로젝트를 서버로 배포하기 위한 **SSH / 배포** 도구.
- 자격 증명을 위한 **시크릿 볼트** (절대 커밋되지 않음).
- **역할별 스킬** — 전문가와 자문단에게 도메인 SKILL 파일을 부착합니다.
- **자율 모드** — 에이전트에게 여러 날에 걸친 목표를 맡기고 작업하게 하며, 일시 정지하고 재개할 수 있습니다.
- Playwright를 통한 **브라우저 자동화 및 이미지 생성**.
- 상한에 도달하면 더 저렴한 모델로 자동 폴백하는 **예산 제어**.

### 🎨 진짜로 멋진 데스크톱 앱
**Tauri + SvelteKit**으로 구축 — 빠르고 네이티브한 데스크톱 콕핏(브라우저 탭이 아닙니다)으로, 깔끔하고 커스텀 디자인된 다크 UI를 갖추고 있습니다: 그라데이션 헤더, 카드 기반 에이전트 목록, 라이브 토큰 게이지, CodeGraph 탐색기, 리포트와 노트.

---

## 🧩 기술 스택

| 레이어 | 기술 |
|-------|------|
| **에이전트** | [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk) (인프로세스) |
| **모델 프로바이더** | Anthropic Claude (Opus / Sonnet / Haiku) · Anthropic 호환 엔드포인트를 통한 DeepSeek V4 (Pro / Flash) |
| **백엔드** | `tsx` 위의 TypeScript, WebSocket (`ws`), Zod |
| **코드 인텔리전스** | tree-sitter (7개 언어) + `better-sqlite3` (FTS) + 임베딩 |
| **자동화** | Playwright / Patchright |
| **데스크톱 UI** | Tauri (Rust) + SvelteKit |

---

## 📦 시작하기

> **상태:** 실제의 멀티 프로젝트 소프트웨어 작업을 운영하기 위해 저작자가 **매일 프로덕션에서 적극적으로 사용 중입니다** — 이것은 데모도 방치된 소프트웨어도 아닙니다. 현재 Windows에서 실행되며 파워 유저용 소프트웨어입니다(코드를 좀 읽을 각오를 하세요). **적극적으로 유지보수되고 있으며 계속 개선될 것입니다 — 관심이 있다면 개발은 이어집니다.** 원하는 것을 담아 [이슈](https://github.com/SeyhmusKaya/agent-symphony/issues)를 열거나, 로드맵 형성을 돕기 위해 [후원](https://github.com/sponsors/SeyhmusKaya)해 주세요.

### 사전 요구 사항
- **Node.js 20+**
- **Claude 액세스** — **Claude Pro / Max 구독** *또는* **Anthropic API 키** 중 하나. 아래 [인증](#-authentication--works-with-your-claude-plan-or-an-api-key)을 참고하세요.
- 데스크톱 빌드의 경우: [Tauri 사전 요구 사항](https://tauri.app/start/prerequisites/) (Rust 툴체인)

### 오케스트레이터 실행 (백엔드)
```bash
git clone https://github.com/SeyhmusKaya/agent-symphony.git
cd agent-symphony
npm install

# copy the secrets template and fill in what you need (optional: ssh/deploy/relay)
cp secrets.local.json.example secrets.local.json

# start the orchestrator
npm start          # or: npm run dev   (tsx watch, auto-reload)
```

### 데스크톱 UI 실행
```bash
cd ui
npm install
npm run tauri dev   # dev mode
# or: npm run tauri build   # produces a native desktop binary
```

### 타입 체크
```bash
npm run typecheck          # backend
cd ui && npm run check     # UI (svelte-check)
```

---

## 🔑 인증 — Claude 플랜, Anthropic 키, *또는* DeepSeek 키

Architect — Agent Symphony는 공식 **Claude Agent SDK** 위에서 실행되며 **두 개의 모델 프로바이더**를 지원합니다. 다음 우선순위 순서로 프로바이더를 선택합니다:

- 🟣 **DeepSeek API 키** *(설정되어 있으면 최우선)* — 앱 내 **API keys** 패널에 DeepSeek 키를 추가하세요(`providers.json`에 로컬로 저장되며 절대 커밋되지 않습니다). 그러면 에이전트는 DeepSeek의 Anthropic 호환 엔드포인트를 통해 **DeepSeek V4 Pro / Flash**에서 실행됩니다. 가장 저렴한 경로이며; Claude 로그인도 있다면 드롭다운에 Claude 모델이 그대로 유지됩니다.
- 🟢 **Claude Pro / Max 구독** *(Claude 사용자에게 추천)* — Claude CLI로 한 번 로그인하세요(`claude login`). 사용량은 기존 **Pro/Max 쿼터에 차감됩니다 — API 키도, 토큰당 청구도 없습니다.**
- 🔵 **Anthropic API 키** *(토큰당 과금)* — `ANTHROPIC_API_KEY`를 설정하세요. Console 청구를 사용하는 팀/자동화에 가장 적합합니다.

> ⚠️ 환경에 `ANTHROPIC_API_KEY`가 설정되어 있으면, 그것이 당신의 Claude 구독보다 **우선합니다**. Claude 모델에 Pro/Max 플랜을 사용하려면 그 변수를 설정하지 않은 채로 두세요(그리고 Pro/Max 계정으로 `claude logout` → `claude login`을 실행하세요). DeepSeek 키는 앱 내에서 별도로 관리되며 DeepSeek 모델 요청에만 영향을 줍니다.

앱의 로컬 프록시는 프롬프트 캐싱만 최적화합니다 — **당신의 자격 증명이나 OAuth 갱신 경로에는 결코 손대지 않으므로**, 두 인증 모드 모두 별도 설정 없이 바로 작동합니다.

---

## ⚙️ 구성

- **인증** — DeepSeek 키(앱 내), Claude Pro/Max 로그인, *또는* `ANTHROPIC_API_KEY` (자세한 내용은 [인증](#-authentication--claude-plan-anthropic-key-or-deepseek-key) 참고).
- **`secrets.local.json`** — 선택적인 SSH / 웹 인증 / 릴레이 자격 증명(git-ignore 처리되며 절대 커밋되지 않음). `secrets.local.json.example`을 참고하세요.
- **기능 플래그** (환경 변수) — long-TTL 프롬프트 캐시, 비동기 위임, 네이티브 컴팩션 같은 선택적 서브시스템을 토글합니다.

> `.github/`, `.team/` 및 런타임 데이터 디렉터리는 git-ignore 처리됩니다 — 자격 증명이나 세션 데이터는 결코 커밋되지 않습니다.

---

## 🗺️ 로드맵

- 크로스 플랫폼 데스크톱 빌드 (macOS / Linux)
- ✅ 플러그형 모델 프로바이더 — **DeepSeek V4 출시 완료**; 더 많은 프로바이더 예정
- 더 풍부한 자율 모드 컨트롤
- 더 많은 CodeGraph 언어

아이디어가 있으신가요? [이슈를 열거나](https://github.com/SeyhmusKaya/agent-symphony/issues), 도움이 된다면 [후원](https://github.com/sponsors/SeyhmusKaya)을 고려해 주세요 💜.

---

## 📄 라이선스

[MIT](LICENSE) © Şeyhmus Kaya

---

<div align="center">

**Architect — Agent Symphony가 당신에게 유용하다면, ⭐ 하나와 [후원](https://github.com/sponsors/SeyhmusKaya)이 큰 힘이 됩니다.**

한 명의 개발자가 정성껏 만들고 지휘했습니다.

</div>
