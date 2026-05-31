# Security Policy

## Reporting a vulnerability
If you find a security issue, **please do not open a public issue.** Instead, report it privately:

- Use GitHub's **[Report a vulnerability](https://github.com/SeyhmusKaya/agent-symphony/security/advisories/new)** (Security → Advisories), **or**
- Open a private channel via [GitHub Sponsors / profile](https://github.com/SeyhmusKaya).

Please include: what you found, how to reproduce it, and the potential impact. I'll respond as soon as I can and credit you (if you want) once a fix ships.

## Scope & handling of secrets
- This app talks to the Anthropic API and can run SSH/deploy and browser-automation tools. Run it on machines you trust.
- Credentials live in `secrets.local.json` and a local vault — both are **git-ignored and never committed**. Never paste real secrets into issues, PRs or logs.
- The local Anthropic proxy only optimizes prompt caching; it does not store or transmit your credentials anywhere except to `api.anthropic.com`.

## Supported versions
This is an actively maintained project; fixes target the latest `main` and the most recent release.
