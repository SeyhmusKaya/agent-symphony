<script lang="ts">
  // Fix 93: tool detail panel — opens from the right when the user clicks a
  // tool item inside the chat. Input (command/file) + result (output) + token
  // details + copy button. Similar to the tool inspector in Claude Code.
  import type { ToolActivity, CanliAktivite } from "$lib/store.svelte";

  let {
    detail = null,
    onClose,
  }: {
    detail?: ToolActivity | CanliAktivite | null;
    onClose?: () => void;
  } = $props();

  let t = $derived(detail);

  function close() {
    onClose?.();
  }

  function pretty(s?: string): string {
    if (!s) return "";
    const trimmed = s.trim();
    // Indent if it's JSON
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        return JSON.stringify(JSON.parse(trimmed), null, 2);
      } catch { /* skip */ }
    }
    return s;
  }

  function copy(text: string) {
    if (!text) return;
    try {
      navigator.clipboard.writeText(text);
    } catch { /* skip */ }
  }

  function fmtTok(n?: number): string {
    if (typeof n !== "number" || !isFinite(n)) return "-";
    if (n < 1000) return String(n);
    if (n < 10_000) return (n / 1000).toFixed(1) + "k";
    return Math.round(n / 1000) + "k";
  }

  // Close with ESC
  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }
</script>

<svelte:window onkeydown={onKey} />

{#if t}
  <div class="overlay" onclick={close} role="presentation"></div>
  <div
    class="panel"
    role="dialog"
    aria-label="Tool detail"
    tabindex="-1"
  >
    <header>
      <div class="title">
        <span class="tool-name">{t.ad}</span>
        {#if "durum" in t && t.durum}
          <span class="badge badge-{t.durum}">{t.durum}</span>
        {/if}
        {#if "hata" in t && t.hata}
          <span class="badge badge-hata">error</span>
        {/if}
      </div>
      <button class="close" onclick={close} aria-label="Close">x</button>
    </header>

    {#if "tokens" in t && t.tokens}
      <section class="meta">
        <div class="meta-row">
          <span class="meta-k">in</span>
          <span class="meta-v">{fmtTok(t.tokens.in)}</span>
          <span class="meta-k">cache_read</span>
          <span class="meta-v">{fmtTok(t.tokens.cacheRead)}</span>
          <span class="meta-k">cache_create</span>
          <span class="meta-v">{fmtTok(t.tokens.cacheCreate)}</span>
          <span class="meta-k">out</span>
          <span class="meta-v">{fmtTok(t.tokens.out)}</span>
          {#if t.tokens.usd}
            <span class="meta-k">usd</span>
            <span class="meta-v">${t.tokens.usd.toFixed(4)}</span>
          {/if}
        </div>
      </section>
    {/if}

    <div class="body">
      {#if t.girdi}
        <section>
          <div class="sec-head">
            <span class="sec-title">INPUT</span>
            <button class="copy" onclick={() => copy(t.girdi!)} aria-label="Copy">copy</button>
          </div>
          <pre class="content">{pretty(t.girdi)}</pre>
        </section>
      {/if}

      {#if t.sonuc}
        <section>
          <div class="sec-head">
            <span class="sec-title">RESULT{#if "hata" in t && t.hata} (error){/if}</span>
            <button class="copy" onclick={() => copy(t.sonuc!)} aria-label="Copy">copy</button>
          </div>
          <pre class="content" class:err={"hata" in t && t.hata}>{pretty(t.sonuc)}</pre>
        </section>
      {/if}

      {#if !t.girdi && !t.sonuc}
        <section class="empty">
          <p>No input/result data has streamed for this tool yet. The tool may still be running.</p>
        </section>
      {/if}
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.18);
    z-index: 90;
    animation: fade 120ms ease-out;
  }
  @keyframes fade {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .panel {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: min(680px, 55vw);
    background: var(--arc-surface, #fff);
    border-left: 1px solid var(--arc-border, rgba(0, 0, 0, 0.08));
    box-shadow: -16px 0 32px rgba(0, 0, 0, 0.08);
    z-index: 91;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slide 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes slide {
    from { transform: translateX(20px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    background: linear-gradient(
      180deg,
      color-mix(in srgb, var(--arc-primary, #0F766E) 10%, var(--arc-surface)) 0%,
      var(--arc-surface) 100%
    );
    border-bottom: 1px solid var(--arc-border, rgba(0, 0, 0, 0.08));
    flex-shrink: 0;
  }
  .title {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .tool-name {
    font-family: var(--arc-mono, monospace);
    font-size: 14px;
    font-weight: 600;
    color: var(--arc-text, #111);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 2px 8px;
    border-radius: 999px;
    font-weight: 600;
    line-height: 1.4;
  }
  .badge-calisiyor {
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 16%, transparent);
    color: var(--arc-primary, #0F766E);
  }
  .badge-bitti {
    background: rgba(34, 197, 94, 0.16);
    color: rgb(21, 128, 61);
  }
  .badge-hata {
    background: rgba(239, 68, 68, 0.16);
    color: rgb(185, 28, 28);
  }
  .close {
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 18px;
    color: var(--arc-text-faint, #888);
    width: 28px;
    height: 28px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    transition: background 100ms, color 100ms;
  }
  .close:hover {
    background: var(--arc-hover, rgba(0, 0, 0, 0.05));
    color: var(--arc-text, #111);
  }
  .meta {
    padding: 10px 18px;
    border-bottom: 1px solid var(--arc-border, rgba(0, 0, 0, 0.06));
    flex-shrink: 0;
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 3%, var(--arc-surface));
  }
  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    align-items: center;
    font-size: 11px;
  }
  .meta-k {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--arc-text-faint, #888);
    font-weight: 600;
  }
  .meta-v {
    color: var(--arc-text, #111);
    font-family: var(--arc-mono, monospace);
    font-weight: 500;
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
  }
  section {
    padding: 12px 18px;
    flex-shrink: 0;
  }
  .sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .sec-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--arc-text-faint, #888);
    font-weight: 700;
  }
  .copy {
    background: transparent;
    border: 1px solid var(--arc-border, rgba(0, 0, 0, 0.1));
    color: var(--arc-text-faint, #666);
    font-size: 10px;
    padding: 3px 9px;
    border-radius: 5px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    transition: background 100ms, color 100ms;
  }
  .copy:hover {
    background: var(--arc-hover, rgba(0, 0, 0, 0.04));
    color: var(--arc-text, #111);
  }
  .content {
    margin: 0;
    padding: 12px;
    background: var(--arc-code-bg, #f6f7f8);
    border: 1px solid var(--arc-border, rgba(0, 0, 0, 0.06));
    border-radius: 8px;
    font-family: var(--arc-mono, monospace);
    font-size: 12px;
    line-height: 1.55;
    color: var(--arc-text, #111);
    white-space: pre-wrap;
    word-break: break-word;
    overflow: visible;
    max-height: none;
  }
  .content.err {
    background: rgba(239, 68, 68, 0.06);
    border-color: rgba(239, 68, 68, 0.2);
  }
  .empty {
    color: var(--arc-text-faint, #888);
    font-size: 13px;
    padding: 24px 18px;
  }
</style>
