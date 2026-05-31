# F2 Skill System — Implementation Notes and SDK Gap

This file documents the Anthropic SDK constraints encountered during the
`docs/master-plan-2026.md` F2 (Skill System) design work and the choices made on
the Architect side.

## Architect Layout (stable)

```
~/.architect/skills/
  global/                <-- loaded for every role (mimar, advisor, sef)
  mimar/                 <-- only the Bas Mimar
  advisor-<key>/         <-- the relevant advisor (seo|finans|...)
  sef-<projectId>/       <-- the relevant project sef
```

Each skill is a subfolder; the only strictly required file inside is `SKILL.md`
(the Anthropic frontmatter convention):

```
---
name: typescript-master
description: TypeScript advanced helper
---

<body>
```

An optional `examples/` subfolder later. For now only `SKILL.md` is read.

## Interaction With the Anthropic SDK

The Anthropic Claude Agent SDK offers two entry points:

1. **`AgentDefinition.skills?: string[]`** — name-based loading into the subagent
   context (the SDK looks it up and injects it into the system prompt).
2. **`ClaudeAgentOptions.skills?: string[] | "all"`** — skill filter for the main
   session. Works together with `settingSources`.

### Known Gap

The SDK discovers the skill `directory` ONLY via these paths (sdk.d.ts `SettingSource`):

- `user`: `~/.claude/skills/`
- `project`: `<cwd>/.claude/skills/`
- `local`: `<cwd>/.claude/skills/` (local override)

Architect keeps skills under `~/.architect/skills/` — the SDK does not see this
directory. As a result:

- A skill named in `ClaudeAgentOptions.skills` cannot be found on disk by the SDK;
  a warning/no-op behavior is likely.
- `AgentDefinition.skills` may not be loaded into the subagent for the same reason;
  SDK name resolution is via `~/.claude/skills/` or a plugin-qualified directory.

### Working Path (current)

The `AgentDefinition.skills` field is filled in `sdkAgents.ts:specToAgent` for each
specialist via `registry.skills` + `loadGlobalSkills()`. If the SDK name match
succeeds it is loaded into the subagent context; if it fails there is no harm
(the SDK flags/skips the name). This way, when Mimar does `load_skill <agent> <skill_name>`
the name list continues to propagate — backward compatible.

### Options For Full Integration (next step)

1. **Symlink bridge**: `~/.architect/skills/<role>/<skill>/` -> `~/.claude/skills/<skill>/`.
   - Advantage: the SDK discovers it, no code change needed.
   - Disadvantage: the role-based separation is lost — the SDK sees all skills every
     session (the filter is only via `options.skills` names).

2. **System prompt injection**: inject the `loadEffectiveSkills(role)` bodies into
   the `IMMUTABLE` block. No SDK skill discovery needed.
   - Advantage: full role-based control.
   - Disadvantage: cache prefix stability — if the skill list changes, one
     cache_create burst (Master plan: 1-3k tokens/skill, 5 skills ~10-15k).

3. **SDK plugin path field**: if the SDK adds custom skill path support later, it
   comes via `settingSources` or a new field.

P0 working solution: (2) — add the SKILL.md `body` content as an IMMUTABLE block to
the sef/mimar/advisor system prompt. Cache prefix stability is preserved (as long as
the skill set stays fixed). F2 does this step in a follow-up sub-task; the current PR
only:

- Sets up the skill filesystem (`orchestrator/skills.ts`).
- Does AgentDefinition.skills propagation (forward-compat).
- Adds the attach/detach/list_skills MCP tools + the UI SkillManager component.

So once `~/.architect/skills/` is populated, Mimar can add skills via attach_skill,
see them via list_skills, and management works in the UI even if SDK propagation is
still missing. System prompt injection is in the next commit.

## UI (SkillManager.svelte)

`ui/src/lib/skills/SkillManager.svelte` is ready as a component; integrating it into
the NotesScreen or Settings tab is a follow-up:

```svelte
<SkillManager />
```

Tabbed by role; gradient teal header (CLAUDE.md design rule). The backend Tauri
command (`list_skills` / `attach_skill` / `detach_skill`) is not yet added on the
Rust side — the api.ts wrappers are ready; once the Rust handler is added the
component works.

## Tools (MCP)

The sef/Mimar see 3 new tools on the SDK side:

- `attach_skill(role, skill_name, source_path?)`
- `detach_skill(role, skill_name)`
- `list_skills(role?)`

In the AGENT_MGMT group (opened via `load_toolset agent_mgmt` or automatically when
the `RX_AGENT_NEW` regex is triggered).
