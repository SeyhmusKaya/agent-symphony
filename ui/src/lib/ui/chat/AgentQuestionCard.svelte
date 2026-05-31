<script lang="ts">
  // ui/src/lib/ui/chat/AgentQuestionCard.svelte — ask_user_choice inline card.
  // Moved from ChatThread (lines 304-372). Each card holds its own local state
  // (selections + free text); instead of the parent qSecimler/qSerbest records,
  // each card is self-contained.
  import Icon from "$lib/icons/Icon.svelte";
  import type { ChatMessage } from "$lib/store.svelte";
  import { fmtTime } from "./helpers.js";

  let {
    msg,
    onCevap,
  }: {
    msg: ChatMessage;
    onCevap?: (cevap: string) => void;
  } = $props();

  // Per-card selection state. Multiple agent_question cards each run with their
  // own state — instead of a global record keyed by askId.
  let secimler = $state<Set<number>>(new Set());
  let serbest = $state("");

  function toggle(i: number, coklu: boolean) {
    if (coklu) {
      const cur = new Set(secimler);
      if (cur.has(i)) cur.delete(i);
      else cur.add(i);
      secimler = cur;
    } else {
      secimler = new Set([i]);
    }
  }

  function gonder() {
    if (!onCevap || !msg.secenekler) return;
    const sec = [...secimler]
      .sort()
      .map((i) => msg.secenekler![i]);
    const sb = serbest.trim();
    const parcalar: string[] = [];
    if (sec.length) parcalar.push(sec.join(", "));
    if (sb) parcalar.push(sb);
    const cevap = parcalar.join(" | ");
    if (!cevap) return;
    onCevap(cevap);
  }

  const hazir = $derived(secimler.size > 0 || serbest.trim().length > 0);
</script>

<div class="turn assist agent-q" class:answered={msg.answered}>
  <div class="agent-q-head">
    <Icon name="message" size={11} stroke={2.2} />
    <span class="agent-q-tag">Agent question</span>
    <span class="turn-time">{fmtTime(msg.ts)}</span>
  </div>
  <div class="agent-q-body">{msg.text}</div>
  {#if msg.secenekler && msg.secenekler.length}
    <div class="agent-q-opts">
      {#each msg.secenekler as s, oi (oi)}
        {@const sec = secimler.has(oi)}
        <button
          type="button"
          class="agent-q-opt"
          class:on={sec}
          disabled={msg.answered}
          onclick={() => {
            if (msg.answered) return;
            toggle(oi, !!msg.cokluSecim);
            // Single choice with no free text: submit directly.
            if (!msg.cokluSecim && !msg.serbestMetin) {
              setTimeout(() => gonder(), 60);
            }
          }}
        >
          <span class="agent-q-tik" aria-hidden="true">{sec ? "✓" : ""}</span>
          <span class="agent-q-opt-text">{s}</span>
        </button>
      {/each}
    </div>
  {/if}
  {#if msg.serbestMetin && !msg.answered}
    <div class="agent-q-serbest">
      <textarea
        placeholder="Other / your own answer…"
        rows="2"
        bind:value={serbest}
        onkeydown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && hazir) {
            gonder();
          }
        }}
      ></textarea>
    </div>
  {/if}
  {#if !msg.answered}
    <div class="agent-q-bar">
      <button
        type="button"
        class="agent-q-send"
        disabled={!hazir}
        onclick={() => gonder()}
      >
        Send answer
      </button>
    </div>
  {:else}
    <div class="agent-q-done">
      <Icon name="check" size={10} stroke={2.6} />
      <span class="agent-q-done-l">Answered:</span>
      <span class="agent-q-done-v">{msg.secim}</span>
    </div>
  {/if}
</div>

<style>
  /* Agent question inline card — exact clone of ChatThread CSS. */
  .turn {
    display: flex;
    flex-direction: column;
    animation: turn-in 0.2s var(--arc-ease);
  }
  @keyframes turn-in {
    from { opacity: 0; transform: translateY(8px); }
  }
  .turn.assist.agent-q {
    align-items: stretch;
    gap: 9px;
    border: 1px solid var(--arc-primary);
    border-radius: 14px;
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 5%, var(--arc-surface));
    padding: 13px 16px 14px;
    box-shadow: 0 1px 3px rgba(15, 118, 110, 0.08);
  }
  .turn.assist.agent-q.answered {
    border-color: var(--arc-border);
    background: var(--arc-surface);
    opacity: 0.85;
  }
  .agent-q-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--arc-primary);
    text-transform: uppercase;
  }
  .agent-q-tag { font-weight: 700; }
  .turn-time {
    margin-left: auto;
    font-weight: 500;
    color: var(--arc-text-faint);
    text-transform: none;
    letter-spacing: 0;
  }
  .agent-q-body {
    font-size: 13.5px;
    line-height: 1.6;
    color: var(--arc-text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .agent-q-opts {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .agent-q-opt {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 12px;
    border: 1px solid var(--arc-border);
    border-radius: 9px;
    background: var(--arc-surface);
    color: var(--arc-text);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, border-color 0.12s, transform 0.08s;
  }
  .agent-q-opt:hover {
    background: color-mix(in srgb, var(--arc-primary) 6%, var(--arc-surface));
    border-color: var(--arc-primary);
  }
  .agent-q-opt:active { transform: translateY(1px); }
  .agent-q-opt:disabled {
    cursor: default;
    opacity: 0.6;
  }
  .agent-q-opt.on {
    background: color-mix(in srgb, var(--arc-primary) 14%, var(--arc-surface));
    border-color: var(--arc-primary);
    color: var(--arc-text);
  }
  .agent-q-tik {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1px solid var(--arc-border);
    border-radius: 4px;
    color: var(--arc-primary);
    font-size: 10px;
    font-weight: 700;
    background: var(--arc-surface);
    flex-shrink: 0;
  }
  .agent-q-opt.on .agent-q-tik {
    background: var(--arc-primary);
    border-color: var(--arc-primary);
    color: #fff;
  }
  .agent-q-opt-text {
    flex: 1;
    line-height: 1.4;
  }
  .agent-q-serbest textarea {
    width: 100%;
    padding: 8px 11px;
    border: 1px solid var(--arc-border);
    border-radius: 8px;
    background: var(--arc-surface);
    color: var(--arc-text);
    font-family: inherit;
    font-size: 12.5px;
    resize: vertical;
    min-height: 44px;
    box-sizing: border-box;
  }
  .agent-q-serbest textarea:focus {
    outline: none;
    border-color: var(--arc-primary);
  }
  .agent-q-bar {
    display: flex;
    justify-content: flex-end;
  }
  .agent-q-send {
    padding: 7px 16px;
    border-radius: 8px;
    background: var(--arc-primary);
    color: #fff;
    border: 1px solid var(--arc-primary);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s, transform 0.08s;
  }
  .agent-q-send:hover { opacity: 0.92; }
  .agent-q-send:active { transform: translateY(1px); }
  .agent-q-send:disabled {
    background: var(--arc-border);
    border-color: var(--arc-border);
    color: var(--arc-text-faint);
    cursor: default;
    opacity: 0.65;
  }
  .agent-q-done {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 11px;
    border-radius: 7px;
    background: color-mix(in srgb, var(--arc-success) 8%, transparent);
    color: var(--arc-text);
    font-size: 12px;
  }
  .agent-q-done :global(svg) { color: var(--arc-success); }
  .agent-q-done-l {
    color: var(--arc-text-faint);
    font-size: 10.5px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 700;
  }
  .agent-q-done-v {
    font-weight: 600;
    color: var(--arc-text);
  }
</style>
