<div align="center">

<img src="docs/img/banner.png" alt="Architect — Agent Symphony" width="100%" />

# Architect — Agent Symphony

### Claude Agent SDK 向けの階層型マルチエージェント・オーケストレーター — マルチプロバイダー対応 (Claude + DeepSeek)

*一人の指揮者。AI エージェントの一団。指揮はあなたの手に。*

[![Sponsor](https://img.shields.io/github/sponsors/SeyhmusKaya?style=for-the-badge&logo=githubsponsors&color=ea4aaa)](https://github.com/sponsors/SeyhmusKaya)
[![Stars](https://img.shields.io/github/stars/SeyhmusKaya/agent-symphony?style=for-the-badge&color=f59e0b)](https://github.com/SeyhmusKaya/agent-symphony/stargazers)
[![Release](https://img.shields.io/github/v/release/SeyhmusKaya/agent-symphony?style=for-the-badge&color=8b5cf6)](https://github.com/SeyhmusKaya/agent-symphony/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/SeyhmusKaya/agent-symphony/ci.yml?branch=main&style=for-the-badge&label=build)](https://github.com/SeyhmusKaya/agent-symphony/actions)
[![Last commit](https://img.shields.io/github/last-commit/SeyhmusKaya/agent-symphony?style=for-the-badge&color=10b981)](https://github.com/SeyhmusKaya/agent-symphony/commits/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg?style=for-the-badge)](LICENSE)
[![Built with Claude Agent SDK](https://img.shields.io/badge/Built%20with-Claude%20Agent%20SDK-0F766E?style=for-the-badge)](https://docs.anthropic.com/en/api/agent-sdk)
[![Desktop: Tauri](https://img.shields.io/badge/Desktop-Tauri%20%2B%20SvelteKit-24c8db?style=for-the-badge&logo=tauri)](https://tauri.app)

<br/>

[Türkçe](README.tr.md) · [English](README.md) · [中文](README.zh.md) · **日本語** · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt.md) · [Русский](README.ru.md)
</div>

---

## 💜 サポート / 寄付

**Architect — Agent Symphony は無料かつオープンソースで、一人の開発者が作っています。** もし時間の節約に役立った、あるいは単にこのアイデアを気に入っていただけたなら、寄付はエージェントを動かし続け、開発を前進させる支えになります。ありがとうございます。🙏

### ⭐ GitHub Sponsors (おすすめ)
最も手軽なサポート方法です。ワンクリックで、継続または一回限り、**プラットフォーム手数料 0%** (100% が作者に届きます):

👉 **[github.com/sponsors/SeyhmusKaya](https://github.com/sponsors/SeyhmusKaya)**

### ₿ 暗号資産

| 資産 | ネットワーク | アドレス |
|-------|---------|---------|
| **USDT** | **TRC20** (Tron) | `TD5DADsYjH3aydsi7zrgDrqVAj3EzWx1Cb` |
| **BTC** | **Bitcoin** | `12W1kc6qvDEwG9QfdjHWtdT2QEKDrTApWm` |
| **ETH** | **ERC20** (Ethereum) | `0x8d0ba54ba688fe70f1f3888ad494817b9fdebc7b` |

> ⚠️ **各資産は必ず上記のネットワークでのみ送金してください。** 誤ったネットワークで送金すると、資金を永久に失う可能性があります。

---

## ✨ これは何?

**Architect — Agent Symphony** は、Claude Agent SDK を **会社のように指揮できる AI エージェントの階層型組織** に変えるデスクトップアプリケーションです。

単一のアシスタントとチャットする代わりに、**専門エージェントの組織図** を動かします。ヘッドアーキテクトがプロジェクトチーフを統括し、各チーフは自身の永続的なスペシャリストを指揮し、ドメインアドバイザーのパネルに相談し、ワンショットのワーカーを派遣します。すべてが並列に、すべてが一つのコックピットの中で、完全なコスト可視性と Claude Code 級のコンテキスト管理とともに行われます。

これは **Claude エージェントのチームのためのミッションコントロール** と考えてください。実際のマルチプロジェクトのソフトウェア作業をオーケストレーションするために専用に作られています。

### 🧭 どこに位置づけられるか

もしあなたが **Claude Code**、**CrewAI**、**AutoGen**、あるいは **LangGraph** を使ったことがあるなら、それらはあなたが *スクリプトを書く* フレームワークや CLI です。**Architect — Agent Symphony** は、**オーケストレーションそのものがプロダクトであるデスクトップコックピット** です。オーケストレーションのコードを書く代わりに、実際のプロジェクトをまたいで常駐するエージェント組織を、ライブのコストとコンテキストの可視性とともに見守り、指揮します。公式の **[Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk)** の上に直接構築されており (インプロセス、別途 CLI 不要)、Claude Code 級の挙動の上にマルチエージェント・マルチプロジェクトの UI が乗っています。

**キーワード:** Claude agent orchestration · DeepSeek agent orchestration · multi-provider LLM agents · multi-agent AI · agentic workflows · autonomous coding agents · Claude Code alternative UI · DeepSeek V4 desktop app · AI software team · MCP tools.

---

## 🌟 何が違うのか

- 🧬 **エージェントごとのスキル** — すべてのエージェントが **自分専用の** スキルファイルを読み込みます。名札を付けただけの汎用チャットボットではなく、深いドメイン知識を持つ本物のスペシャリストを構築できます。
- 🤖 **タスクに応じてスキルを自動割り当て** — チーフが新しいスペシャリストを立ち上げると、その仕事に適したドメインスキルを **自動的に継承** します。デザインスペシャリストにはデザインスキルが、セキュリティ担当にはセキュリティスキルが付きます。
- 🗂️ **ブラウザのタブのようにプロジェクトを切り替え** — それぞれが独自のエージェント、コンテキスト、履歴、コストメーターを持つ、複数の **稼働中プロジェクトと並列セッション** を Chrome のタブのように行き来できます。
- 💬 **エージェント同士が会話する** — チーフはアドバイザーに相談し、他のプロジェクトチーフにメッセージを送ります。作業はあなたがトップダウンで指示するだけでなく、*エージェント間で交渉* されます。
- 🌙 **夜間に自己改善** — ヘッドアーキテクトは **毎晩自分自身のコードベースを分析し、改善を自律的に提案・出荷** できます。あなたが眠っている間もオーケストレーターは良くなり続けます。
- ⚡ **デフォルトで並列** — 独立したサブタスクは一度に多数のエージェントへファンアウトされ、その後、指揮者が結果をマージします。

---

## 📸 コックピット

<div align="center">
<img src="docs/img/app-screenshot.png" alt="Architect — Agent Symphony desktop cockpit" width="100%" />
</div>

---

## 🎼 シンフォニー — 階層がどう演奏するか

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

| 役割 | 何であるか | 寿命 |
|------|-----------|----------|
| 🏛️ **Architect** | 指揮者。エコシステム全体を統括し、オーケストレーター自体を開発し、チーフ間で作業をルーティングします。 | 常時稼働 |
| 👔 **Project Chief** | プロジェクトごとに 1 名。プロジェクトのシニアエンジニアであり、コード、git、ssh/デプロイを所有します。他のチーフと会話します。 | 永続 |
| 🧑‍💻 **Specialist** | チーフの永続的なエキスパート (例: *Frontend Specialist*、*Backend Specialist*)。隔離された並列エージェントウィンドウでコードを書き、編集します。 | 永続 |
| 🎓 **Advisor** | 11 名の固定ドメインエキスパート (デザイン/UI、SEO、セキュリティ、法務、マーケティング、財務、会計、データ、devops、ソーシャル、トレーディング)。意思決定支援であり、コードは書きません。 | 組み込み |
| ⚡ **Worker** | 素早い探索や単一の編集のためのワンショットの匿名エージェント。 | 一時的 |

エージェントは互いに会話し (エージェント間メッセージング)、並列に委任し、指揮者が結果を縫い合わせます。だから、あなたが一つの指示を出せば、チーム全体が実行します。

---

## 🚀 機能

### 🧠 Claude Code 級のコンテキストエンジニアリング
- **ネイティブ SDK コンパクション** — コンテキストは Claude Code のやり方で *同一セッション内で* コンパクトされ (セッション ID は保持されます)、レガシーな要約・引き継ぎのフォールバックにより、エージェントが **作業メモリを失うことはありません**。
- **セッションごと・エージェントごとのトークン & コスト追跡** — すべてのターンで fresh / cache-read / cache-write トークンと正確な USD コストが表示されます。
- **プロンプトキャッシュを意識した設計** — 安定したツールセットとキャッシュに優しいプロンプトレイアウトにより、キャッシュヒット率を高く保ちます (高コストな書き換えではなく安価な読み取り)。
- **遅延ツールグループ** — エージェントはツールセットをオンデマンドで読み込み (`load_toolset`)、ターンごとのトークンの下限を低く保ちます。

### 🔀 マルチプロバイダーのモデルルーティング (Claude + DeepSeek)
- **2 つのプロバイダー、1 つのコックピット** — エージェントを **Anthropic Claude** (Opus / Sonnet / Haiku) **または DeepSeek V4** (`deepseek-v4-pro` / `deepseek-v4-flash`) で実行できます。同じドロップダウンからエージェントごとにモデルを選べます。
- **自動プロバイダー優先順位** — DeepSeek API キーが設定されていれば DeepSeek が最初に使われ、なければ Anthropic API キー、それもなければ Claude Pro/Max ログインが使われます。コード変更は不要です。
- **DeepSeek における妥当なロールデフォルト** — チーフ、ヘッドアーキテクト、アドバイザーはデフォルトで **DeepSeek V4 Pro**、ワンショットのスペシャリスト/ワーカーはより安価な **DeepSeek V4 Flash** になります。
- **仕組み** — DeepSeek にはその **Anthropic 互換エンドポイント** (`https://api.deepseek.com/anthropic`) を通じて到達するため、同じ Agent SDK のリクエスト形式、ツールコール、思考モード、1M トークンのコンテキストウィンドウがそのまま動作します。モデルごと・トークンごとの USD コストは各プロバイダーで正しく追跡されます。
- **ライブ切り替え** — 稼働中のエージェントのモデルを、セッションの途中で Claude から DeepSeek へ (またはその逆へ) 変更できます。ルーティングはリクエストごとに選択されたモデルに従います。

### 🕸️ CodeGraph — セマンティックなコードインテリジェンス
リポジトリ全体にわたる組み込みのコードグラフ (TypeScript、JavaScript、Python、PHP、C#、Dart、Svelte 向けの **tree-sitter** + **SQLite FTS** + 埋め込みによって駆動):
- `code_search`, `code_node`, `code_callers`, `code_callees`, `code_impact`, `code_imports`, `code_files`, `code_stats`
- エージェントは闇雲に grep する代わりにグラフを問い合わせます。より速く、より安く、より正確です。ファイル変更時に自動で再インデックスします。

### 👥 マルチエージェント・オーケストレーション
- **並列委任** — 独立したサブタスクは一括して複数のエージェントへファンアウトされます。
- 独自のアイデンティティ、スキル、チャット履歴を持つ **永続的なスペシャリスト**。
- **エージェント間通信** — チーフはアドバイザーに相談し、互いにメッセージを送ります (`talk_to_chief`)。
- **ライブアクティビティビュー** — 作業中の任意のスペシャリストをクリックすると、受け取ったプロンプトと今まさに何をしているかを確認できます。
- **バックグラウンド委任** — 長時間実行のスペシャリストを起動しつつ、チーフとのチャットを続けられます。結果は準備ができ次第戻ってきます。

### 🗂️ マルチプロジェクト・マルチセッションのコックピット
- 多数のプロジェクトを管理し、それぞれが独自のチーフとエージェントを持ちます。
- エージェントごとに Claude Code スタイルの複数の並列セッションを持ち、それぞれが独自のコンテキスト、コスト、履歴を持ちます。
- セッションは **静かにリセットされることは決してありません** — あなたのコンテキストは停止、再起動、再試行を生き延びます。

### 🛠️ 実務向けのオペレーターツール
- プロジェクトをサーバーへ出荷するための **SSH / デプロイ** ツール。
- 認証情報のための **シークレットボールト** (決してコミットされません)。
- **ロールごとのスキル** — ドメインの SKILL ファイルをスペシャリストやアドバイザーにアタッチできます。
- **自律モード** — エージェントに数日がかりの目標を渡して作業させ、一時停止・再開できます。
- Playwright による **ブラウザ自動化と画像生成**。
- 上限に達したときに自動でより安価なモデルにフォールバックする **予算管理**。

### 🎨 本当に心地よいデスクトップアプリ
**Tauri + SvelteKit** で構築 — 高速でネイティブなデスクトップコックピット (ブラウザのタブではありません)。クリーンでカスタムデザインされたダーク UI を備えています: グラデーションヘッダー、カードベースのエージェントリスト、ライブのトークンゲージ、CodeGraph エクスプローラー、レポート、ノート。

---

## 🧩 技術スタック

| レイヤー | 技術 |
|-------|------|
| **エージェント** | [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk) (インプロセス) |
| **モデルプロバイダー** | Anthropic Claude (Opus / Sonnet / Haiku) · DeepSeek V4 (Pro / Flash)、Anthropic 互換エンドポイント経由 |
| **バックエンド** | `tsx` 上の TypeScript、WebSocket (`ws`)、Zod |
| **コードインテリジェンス** | tree-sitter (7 言語) + `better-sqlite3` (FTS) + 埋め込み |
| **自動化** | Playwright / Patchright |
| **デスクトップ UI** | Tauri (Rust) + SvelteKit |

---

## 📦 はじめに

> **ステータス:** 作者が実際のマルチプロジェクトのソフトウェア作業を回すために **毎日プロダクションで実運用中** です。これはデモでも放置プロジェクトでもありません。現在は Windows 上で動作し、パワーユーザー向けのソフトウェアです (多少のコードを読むことを想定してください)。**積極的にメンテナンスされており、改善され続けます — 関心があれば開発は継続します。** 望むものを添えて [issue](https://github.com/SeyhmusKaya/agent-symphony/issues) を立てるか、ロードマップの形成を後押しするために [スポンサー](https://github.com/sponsors/SeyhmusKaya) になってください。

### 前提条件
- **Node.js 20+**
- **Claude へのアクセス** — **Claude Pro / Max サブスクリプション** *または* **Anthropic API キー** のいずれか。下記の [認証](#-authentication--works-with-your-claude-plan-or-an-api-key) を参照してください。
- デスクトップビルドの場合: [Tauri の前提条件](https://tauri.app/start/prerequisites/) (Rust ツールチェーン)

### オーケストレーター (バックエンド) の実行
```bash
git clone https://github.com/SeyhmusKaya/agent-symphony.git
cd agent-symphony
npm install

# copy the secrets template and fill in what you need (optional: ssh/deploy/relay)
cp secrets.local.json.example secrets.local.json

# start the orchestrator
npm start          # or: npm run dev   (tsx watch, auto-reload)
```

### デスクトップ UI の実行
```bash
cd ui
npm install
npm run tauri dev   # dev mode
# or: npm run tauri build   # produces a native desktop binary
```

### 型チェック
```bash
npm run typecheck          # backend
cd ui && npm run check     # UI (svelte-check)
```

---

## 🔑 認証 — Claude プラン、Anthropic キー、*または* DeepSeek キー

Architect — Agent Symphony は公式の **Claude Agent SDK** 上で動作し、**2 つのモデルプロバイダー** をサポートします。次の優先順位でプロバイダーを選びます:

- 🟣 **DeepSeek API キー** *(設定されている場合は最優先)* — アプリ内の **API keys** パネルで DeepSeek キーを追加します (ローカルの `providers.json` に保存され、決してコミットされません)。するとエージェントは DeepSeek の Anthropic 互換エンドポイントを通じて **DeepSeek V4 Pro / Flash** で実行されます。最も安価な経路です。Claude ログインも持っている場合、Claude モデルはドロップダウンに残ります。
- 🟢 **Claude Pro / Max サブスクリプション** *(Claude ユーザーにおすすめ)* — Claude CLI で一度ログインします (`claude login`)。使用量は既存の **Pro/Max クォータ** にカウントされます — **API キー不要、トークンごとの請求もありません。**
- 🔵 **Anthropic API キー** *(トークン従量課金)* — `ANTHROPIC_API_KEY` を設定します。Console 請求を使うチームや自動化に最適です。

> ⚠️ 環境に `ANTHROPIC_API_KEY` が設定されていると、それが Claude サブスクリプションよりも **優先されます**。Claude モデルに Pro/Max プランを使うには、その変数を未設定のままにしてください (そして Pro/Max アカウントで `claude logout` → `claude login` を実行してください)。DeepSeek キーはアプリ内で別途管理され、DeepSeek モデルのリクエストにのみ影響します。

アプリのローカルプロキシはプロンプトキャッシュを最適化するだけで、**あなたの認証情報や OAuth リフレッシュ経路には決して触れません**。そのため、どちらの認証モードもそのまま動作します。

---

## ⚙️ 設定

- **認証** — DeepSeek キー (アプリ内)、Claude Pro/Max ログイン、*または* `ANTHROPIC_API_KEY` ([認証](#-authentication--claude-plan-anthropic-key-or-deepseek-key) を参照)。
- **`secrets.local.json`** — オプションの SSH / Web 認証 / リレー認証情報 (git で無視され、決してコミットされません)。`secrets.local.json.example` を参照してください。
- **フィーチャーフラグ** (環境変数) — 長 TTL のプロンプトキャッシュ、非同期委任、ネイティブコンパクションなどのオプションのサブシステムを切り替えます。

> `.github/`、`.team/`、およびランタイムデータのディレクトリは git で無視されます — 認証情報やセッションデータが決してコミットされることはありません。

---

## 🗺️ ロードマップ

- クロスプラットフォームのデスクトップビルド (macOS / Linux)
- ✅ プラグイン可能なモデルプロバイダー — **DeepSeek V4 を出荷済み**。さらなるプロバイダーが登場予定
- より豊富な自律モードの制御
- より多くの CodeGraph 対応言語

アイデアはありますか? [issue を立てる](https://github.com/SeyhmusKaya/agent-symphony/issues) か、役に立っているなら [スポンサー](https://github.com/sponsors/SeyhmusKaya) を検討してください 💜。

---

## 📄 ライセンス

[MIT](LICENSE) © Şeyhmus Kaya

---

<div align="center">

**Architect — Agent Symphony があなたの役に立っているなら、⭐ と [スポンサーシップ](https://github.com/sponsors/SeyhmusKaya) が大きな力になります。**

一人の開発者によって、心を込めて指揮されています。

</div>
