# Contributing to Architect — Agent Symphony

Thanks for your interest! 💜 Contributions, ideas and bug reports are all welcome.

## Ways to help
- 🐛 **Report bugs** — open an [issue](https://github.com/SeyhmusKaya/agent-symphony/issues) with steps to reproduce, logs and your OS.
- 💡 **Suggest features** — open an issue or start a [Discussion](https://github.com/SeyhmusKaya/agent-symphony/discussions).
- 🧑‍💻 **Send a PR** — see below.
- ⭐ **Star** the repo and tell others — it genuinely helps.
- 💖 **[Sponsor](https://github.com/sponsors/SeyhmusKaya)** — funds continued development.

## Development setup
```bash
git clone https://github.com/SeyhmusKaya/agent-symphony.git
cd agent-symphony
npm install
npm run dev          # orchestrator (tsx watch)

cd ui && npm install
npm run tauri dev    # desktop UI
```
You need either a Claude Pro/Max login or an `ANTHROPIC_API_KEY` (see the README's Authentication section).

## Before opening a PR
- **Type-check passes**: `npm run typecheck` (backend) and `cd ui && npm run check` (UI). CI runs these on every PR.
- **Keep it focused** — one logical change per PR; describe what and why.
- **Match the existing style** — the code uses plain LF line endings (enforced by `.gitattributes`), TypeScript, and the surrounding conventions of the file you touch.
- **Comments and UI text in English.**
- **Never commit secrets** — `secrets.local.json`, `.team/`, `.architect/` and runtime data are git-ignored; keep it that way.

## Good first issues
Look for issues labeled [`good first issue`](https://github.com/SeyhmusKaya/agent-symphony/labels/good%20first%20issue) — they're scoped to be approachable.

## Code of conduct
Be respectful and constructive. Harassment or hostile behavior isn't welcome.

By contributing, you agree your contributions are licensed under the project's [MIT License](LICENSE).
