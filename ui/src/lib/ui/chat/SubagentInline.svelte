<script lang="ts">
  // ui/src/lib/ui/chat/SubagentInline.svelte — F1.4
  // Renders the SDK native "Agent" tool call in the chief chat as an enriched
  // card. Instead of the old plain ToolItem: avatar + specialist name + duration
  // + tool count + USD + status badge + result preview + "Detail" button.
  //
  // Data source: the subagent_type / description / prompt fields inside the
  // tool.girdi JSON string (SDK Agent input schema). Parsing is defensive — if
  // the JSON is broken it shows a generic "Agent".
  //
  // Style: inspired by ToolItem.svelte's vocabulary but distinct — left teal
  // stripe + gradient header + hover lift + pulse animation (while running).
  // Follows the CLAUDE.md corporate design rule.
  import Icon from "$lib/icons/Icon.svelte";
  import type { ToolActivity, CanliAktivite } from "$lib/store.svelte";
  import { fmtTokenShort, toolTotalIn } from "./helpers.js";

  let {
    tool,
    onInspect,
    live = false,
  }: {
    tool: ToolActivity | CanliAktivite;
    onInspect?: (t: ToolActivity | CanliAktivite) => void;
    // Fix 142: whether this card is part of the live streaming turn (true) or a
    // sealed/past turn (false). On a sealed turn it does not get stuck in "calisiyor" even if the result is empty.
    live?: boolean;
  } = $props();

  // Agent tool input SDK schema: { subagent_type, description, prompt }.
  // Fix 141: in the live stream the input arrives TRUNCATED (the backend kisalt()
  // cuts a long prompt to 280 chars -> invalid JSON -> JSON.parse throws). The old
  // behavior showed a generic "Agent" in this case. Fix: if parsing fails, extract
  // fields from the raw string with regex (same method as the left-panel helpers getter).
  const fields = $derived.by(() => {
    const raw = tool.girdi ?? "";
    let parsed: Record<string, unknown> | null = null;
    if (raw && raw.trim().startsWith("{")) {
      try {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === "object") parsed = obj as Record<string, unknown>;
      } catch {
        parsed = null;
      }
    }
    const pick = (key: string): string => {
      if (parsed && typeof parsed[key] === "string") return parsed[key] as string;
      const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(raw);
      return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, " ") : "";
    };
    return {
      subagentType: pick("subagent_type") || "Agent",
      description: pick("description"),
      promptText: pick("prompt"),
    };
  });

  const subagentType = $derived(fields.subagentType);
  const description = $derived(fields.description);
  const promptText = $derived(fields.promptText);

  // Status detection — for CanliAktivite the .durum field; for ToolActivity it
  // counts as "bitti" if .sonuc is filled. The error flag exists on both.
  const status = $derived.by<"calisiyor" | "bitti" | "hata">(() => {
    if (tool.hata) return "hata";
    const durum = (tool as CanliAktivite).durum;
    if (durum === "calisiyor") return "calisiyor";
    if (durum === "hata") return "hata";
    if (durum === "bitti") return "bitti";
    // ToolActivity path: if sonuc is filled it is finished.
    if (tool.sonuc && tool.sonuc.length > 0) return "bitti";
    // Fix 142: sonuc empty. On a live turn it is still running; on a sealed/past
    // turn (live=false) the turn is over -> treat the tool as finished, do NOT get stuck in "calisiyor".
    return live ? "calisiyor" : "bitti";
  });

  const running = $derived(status === "calisiyor");

  // Total input tokens — the Agent tool's cost is reflected in the round. Show
  // only if the info exists; do not render the badge when unknown.
  const promptIn = $derived(toolTotalIn(tool.tokens));
  const tokenOut = $derived(tool.tokens?.out ?? 0);
  const usd = $derived(tool.tokens?.usd ?? 0);

  // Result preview — first 200 chars, collapse whitespace to single spaces.
  const preview = $derived.by(() => {
    const s = tool.sonuc ?? "";
    if (!s) return "";
    const flat = s.replace(/\s+/g, " ").trim();
    return flat.length > 200 ? flat.slice(0, 200) + "…" : flat;
  });

  // Fix 128: subagent live progress — text/tool steps arriving via
  // forwardSubagentText. The last ~260 chars are shown; while running the card
  // streams live instead of "Thinking". tool.ilerleme is optional on both types (ToolActivity | CanliAktivite).
  const ilerleme = $derived.by(() => {
    const s = (tool as { ilerleme?: string }).ilerleme ?? "";
    if (!s) return "";
    const flat = s.replace(/\s+/g, " ").trim();
    return flat.length > 260 ? "…" + flat.slice(-260) : flat;
  });

  // Avatar letter — first meaningful character of subagentType, fallback "A".
  const avatarChar = $derived.by(() => {
    const s = subagentType.trim();
    if (!s) return "A";
    return s.charAt(0).toUpperCase();
  });

  // Badge text by status — English, no abbreviation.
  const statusLabel = $derived.by(() => {
    if (status === "calisiyor") return "running";
    if (status === "hata") return "error";
    return "done";
  });

  function inspectClick(e: MouseEvent) {
    if (!onInspect) return;
    e.preventDefault();
    e.stopPropagation();
    onInspect(tool);
  }
</script>

<div
  class="sa-card"
  class:running
  class:err={status === "hata"}
  class:done={status === "bitti"}
>
  <div class="sa-head">
    <div class="sa-avatar" class:pulse={running}>
      <span class="sa-avatar-ch">{avatarChar}</span>
      {#if running}
        <span class="sa-avatar-ring" aria-hidden="true"></span>
      {/if}
    </div>
    <div class="sa-id">
      <div class="sa-name-row">
        <span class="sa-name">{subagentType}</span>
        <span class="sa-tag">specialist</span>
      </div>
      {#if description}
        <div class="sa-desc" title={description}>{description}</div>
      {:else if promptText}
        <div class="sa-desc sa-prompt" title={promptText}>
          {promptText.length > 90 ? promptText.slice(0, 90) + "…" : promptText}
        </div>
      {/if}
    </div>
    <div class="sa-status" data-status={status}>
      {#if running}
        <Icon name="loader" size={10} stroke={2.4} spin={true} />
      {:else if status === "hata"}
        <Icon name="x" size={10} stroke={2.6} />
      {:else}
        <Icon name="check" size={10} stroke={2.6} />
      {/if}
      <span>{statusLabel}</span>
    </div>
  </div>

  <div class="sa-meta">
    {#if promptIn > 0 || tokenOut > 0}
      <span
        class="sa-chip"
        title={`Total prompt: ${promptIn}\n  • uncached: ${tool.tokens?.in ?? 0}\n  • cache_read: ${tool.tokens?.cacheRead ?? 0}\n  • cache_create: ${tool.tokens?.cacheCreate ?? 0}\nout: ${tokenOut}`}
      >
        <Icon name="cpu" size={10} stroke={2.2} />
        <span>{fmtTokenShort(promptIn)}&darr; {fmtTokenShort(tokenOut)}&uarr;</span>
      </span>
    {/if}
    {#if usd > 0}
      <span class="sa-chip sa-usd" title={`Cost: $${usd.toFixed(4)}`}>
        <span class="sa-usd-sign">$</span>
        <span>{usd.toFixed(usd < 0.01 ? 4 : 3)}</span>
      </span>
    {/if}
    {#if onInspect}
      <button
        class="sa-detay"
        title="All input/output and token detail"
        onclick={inspectClick}
        aria-label="Open detail panel"
      >Detail</button>
    {/if}
  </div>

  {#if preview}
    <div class="sa-preview">
      <span class="sa-preview-k">result</span>
      <span class="sa-preview-v">{preview}</span>
    </div>
  {:else if running && ilerleme}
    <!-- Fix 128: subagent live progress — streaming text/steps instead of "Thinking". -->
    <div class="sa-preview sa-preview-live">
      <span class="sa-preview-k">live</span>
      <span class="sa-preview-v">{ilerleme}</span>
    </div>
  {:else if running}
    <div class="sa-preview sa-preview-empty">
      <span class="sa-dot"></span>
      <span class="sa-dot"></span>
      <span class="sa-dot"></span>
      <span class="sa-thinking">Specialist working</span>
    </div>
  {/if}
</div>

<style>
  /* ---- Card chassis ---- */
  .sa-card {
    position: relative;
    border: 1px solid color-mix(in srgb, var(--arc-primary, #0F766E) 30%, var(--arc-border));
    border-left: 3px solid var(--arc-primary, #0F766E);
    border-radius: 10px;
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--arc-primary, #0F766E) 6%, #ffffff) 0%,
        #ffffff 55%
      );
    padding: 10px 13px 11px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    transition:
      transform 0.18s var(--arc-ease, ease),
      box-shadow 0.18s var(--arc-ease, ease),
      border-color 0.18s var(--arc-ease, ease);
    align-self: stretch;
    max-width: 100%;
    overflow: hidden;
  }
  .sa-card:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 14px -6px color-mix(in srgb, var(--arc-primary, #0F766E) 35%, transparent);
    border-color: color-mix(in srgb, var(--arc-primary, #0F766E) 55%, var(--arc-border));
  }
  .sa-card.err {
    border-color: color-mix(in srgb, var(--arc-danger) 45%, var(--arc-border));
    border-left-color: var(--arc-danger);
    background:
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--arc-danger) 6%, #ffffff) 0%,
        #ffffff 60%
      );
  }
  .sa-card.running {
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--arc-primary, #0F766E) 20%, transparent);
  }

  /* ---- Header row ---- */
  .sa-head {
    display: flex;
    align-items: center;
    gap: 11px;
    min-width: 0;
  }
  .sa-avatar {
    position: relative;
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--arc-primary, #0F766E) 0%, color-mix(in srgb, var(--arc-primary, #0F766E) 70%, #134e4a) 100%);
    color: #ffffff;
    display: grid;
    place-items: center;
    font-size: 12.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    box-shadow: 0 1px 3px color-mix(in srgb, var(--arc-primary, #0F766E) 35%, transparent);
  }
  .sa-card.err .sa-avatar {
    background: linear-gradient(135deg, var(--arc-danger) 0%, color-mix(in srgb, var(--arc-danger) 70%, #7f1d1d) 100%);
    box-shadow: 0 1px 3px color-mix(in srgb, var(--arc-danger) 35%, transparent);
  }
  .sa-avatar-ch {
    line-height: 1;
  }
  /* Pulse ring — while running */
  .sa-avatar-ring {
    position: absolute;
    inset: -3px;
    border-radius: 50%;
    border: 2px solid color-mix(in srgb, var(--arc-primary, #0F766E) 60%, transparent);
    animation: sa-pulse 1.6s var(--arc-ease, ease-out) infinite;
    pointer-events: none;
  }
  @keyframes sa-pulse {
    0% { transform: scale(0.85); opacity: 0.9; }
    70% { transform: scale(1.25); opacity: 0; }
    100% { transform: scale(1.25); opacity: 0; }
  }

  .sa-id {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .sa-name-row {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }
  .sa-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--arc-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .sa-tag {
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--arc-primary-strong, #0F766E);
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--arc-primary, #0F766E) 30%, transparent);
    padding: 1px 6px 1px 6px;
    border-radius: 999px;
    line-height: 1.4;
  }
  .sa-desc {
    font-size: 11px;
    color: var(--arc-text-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.4;
  }
  .sa-prompt {
    font-family: var(--arc-mono, monospace);
    color: var(--arc-text-faint);
    font-size: 10.5px;
  }

  /* ---- Status badge ---- */
  .sa-status {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 3px 8px 3px 7px;
    border-radius: 999px;
    line-height: 1.3;
  }
  .sa-status[data-status="calisiyor"] {
    color: var(--arc-primary-strong, #0F766E);
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--arc-primary, #0F766E) 30%, transparent);
  }
  .sa-status[data-status="bitti"] {
    color: var(--arc-success, #047857);
    background: color-mix(in srgb, var(--arc-success, #047857) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--arc-success, #047857) 30%, transparent);
  }
  .sa-status[data-status="hata"] {
    color: var(--arc-danger);
    background: color-mix(in srgb, var(--arc-danger) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--arc-danger) 30%, transparent);
  }

  /* ---- Meta bar: token / usd / detail ---- */
  .sa-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    min-height: 0;
  }
  .sa-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--arc-mono, monospace);
    font-size: 10.5px;
    color: var(--arc-text-soft);
    background: color-mix(in srgb, var(--arc-text) 5%, transparent);
    border: 1px solid var(--arc-border);
    border-radius: 5px;
    padding: 2px 7px;
    line-height: 1.4;
    cursor: help;
  }
  .sa-chip :global(svg) {
    color: var(--arc-text-faint);
  }
  .sa-usd {
    color: var(--arc-primary-strong, #0F766E);
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 8%, transparent);
    border-color: color-mix(in srgb, var(--arc-primary, #0F766E) 28%, var(--arc-border));
    font-weight: 600;
  }
  .sa-usd-sign {
    font-weight: 700;
    opacity: 0.85;
  }
  .sa-detay {
    margin-left: auto;
    background: transparent;
    border: 1px solid var(--arc-border);
    border-radius: 5px;
    padding: 2px 9px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--arc-text-soft);
    cursor: pointer;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }
  .sa-detay:hover {
    color: var(--arc-primary, #0F766E);
    border-color: var(--arc-primary, #0F766E);
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 8%, transparent);
  }

  /* ---- Result preview ---- */
  .sa-preview {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 10px;
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 4%, var(--arc-bg, #ffffff));
    border: 1px dashed color-mix(in srgb, var(--arc-primary, #0F766E) 22%, var(--arc-border));
    border-radius: 6px;
    font-size: 11.5px;
    line-height: 1.55;
    color: var(--arc-text);
    word-break: break-word;
  }
  .sa-preview-k {
    flex-shrink: 0;
    font-family: var(--arc-mono, monospace);
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--arc-text-faint);
    margin-top: 2px;
  }
  .sa-preview-v {
    flex: 1;
    color: var(--arc-text-soft);
  }
  /* Fix 128: live progress — solid teal border + slight background tint */
  .sa-preview-live {
    border-style: solid;
    border-color: color-mix(in srgb, var(--arc-primary, #0F766E) 35%, var(--arc-border));
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 6%, var(--arc-bg, #ffffff));
    animation: sa-live 2s var(--arc-ease, ease) infinite;
  }
  .sa-preview-live .sa-preview-v {
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }
  @keyframes sa-live {
    0%, 100% { border-color: color-mix(in srgb, var(--arc-primary, #0F766E) 30%, var(--arc-border)); }
    50% { border-color: color-mix(in srgb, var(--arc-primary, #0F766E) 55%, var(--arc-border)); }
  }
  /* Running: three-dot animation */
  .sa-preview-empty {
    align-items: center;
    color: var(--arc-text-faint);
    font-style: italic;
  }
  .sa-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--arc-primary, #0F766E);
    opacity: 0.4;
    animation: sa-dot 1.2s var(--arc-ease, ease) infinite;
  }
  .sa-dot:nth-child(2) { animation-delay: 0.15s; }
  .sa-dot:nth-child(3) { animation-delay: 0.3s; }
  .sa-thinking {
    margin-left: 4px;
    font-size: 11px;
  }
  @keyframes sa-dot {
    0%, 80%, 100% { opacity: 0.35; transform: scale(0.9); }
    40% { opacity: 1; transform: scale(1.15); }
  }
</style>
