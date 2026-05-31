<script lang="ts">
  import type { AjanSoru } from "$lib/store.svelte";

  let {
    soru,
    onCevap,
  }: {
    soru: AjanSoru | null;
    onCevap: (cevap: string) => void;
  } = $props();

  let secili = $state<Set<number>>(new Set());
  let serbest = $state("");

  // Reset state whenever the question changes.
  let lastId = "";
  $effect(() => {
    if (soru && soru.askId !== lastId) {
      lastId = soru.askId;
      secili = new Set();
      serbest = "";
    }
  });

  function toggleSec(i: number) {
    if (!soru) return;
    if (soru.cokluSecim) {
      if (secili.has(i)) secili.delete(i);
      else secili.add(i);
      secili = new Set(secili);
    } else {
      secili = new Set([i]);
    }
  }

  function onayla() {
    if (!soru) return;
    const sec = [...secili].sort().map((i) => soru.secenekler[i]);
    const parcalar: string[] = [];
    if (sec.length) parcalar.push(sec.join(", "));
    if (serbest.trim()) parcalar.push(serbest.trim());
    const cevap = parcalar.join(" | ");
    if (!cevap) return;
    onCevap(cevap);
  }

  function iptal() {
    onCevap("(user cancelled)");
  }

  function hizliSec(i: number) {
    if (!soru) return;
    if (soru.cokluSecim) {
      toggleSec(i);
    } else {
      secili = new Set([i]);
      // Single choice with no free text: submit directly on click.
      if (!soru.serbestMetin) {
        setTimeout(onayla, 50);
      }
    }
  }

  const canSubmit = $derived(
    !!soru && (secili.size > 0 || serbest.trim().length > 0),
  );
</script>

{#if soru}
  <div
    class="ask-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="ask-soru"
    onclick={(e) => {
      if (e.target === e.currentTarget) iptal();
    }}
    onkeydown={(e) => {
      if (e.key === "Escape") iptal();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canSubmit) onayla();
    }}
    tabindex="-1"
  >
    <div class="ask-modal">
      <div class="ask-head">
        <span class="ask-tag">Agent is asking</span>
        <h3 id="ask-soru" class="ask-soru">{soru.soru}</h3>
      </div>
      <div class="ask-secenekler">
        {#each soru.secenekler as s, i (i)}
          <button
            type="button"
            class="ask-sec"
            class:on={secili.has(i)}
            onclick={() => hizliSec(i)}
          >
            <span class="ask-sec-tik" aria-hidden="true">
              {secili.has(i) ? "✓" : ""}
            </span>
            <span class="ask-sec-text">{s}</span>
          </button>
        {/each}
      </div>
      {#if soru.serbestMetin}
        <div class="ask-serbest">
          <label for="ask-serbest-input" class="ask-serbest-label">
            Other / your own answer
          </label>
          <textarea
            id="ask-serbest-input"
            bind:value={serbest}
            placeholder="Write your own text…"
            rows="2"
          ></textarea>
        </div>
      {/if}
      <div class="ask-bar">
        <button type="button" class="ask-iptal" onclick={iptal}>Cancel</button>
        <button
          type="button"
          class="ask-onay"
          disabled={!canSubmit}
          onclick={onayla}
        >
          Send
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ask-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(8, 12, 16, 0.55);
    backdrop-filter: blur(4px);
    display: grid;
    place-items: center;
    z-index: 1000;
    animation: ask-fade 0.15s var(--arc-ease);
  }
  @keyframes ask-fade {
    from {
      opacity: 0;
    }
  }
  .ask-modal {
    width: min(540px, 92vw);
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r);
    box-shadow: var(--arc-shadow);
    padding: 22px 22px 18px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    animation: ask-pop 0.18s var(--arc-ease);
  }
  @keyframes ask-pop {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.98);
    }
  }
  .ask-head {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .ask-tag {
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--arc-primary);
  }
  .ask-soru {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: var(--arc-text);
    line-height: 1.5;
  }
  .ask-secenekler {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .ask-sec {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 10px 13px;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    background: var(--arc-surface-2);
    color: var(--arc-text);
    font-size: 13.5px;
    text-align: left;
    cursor: pointer;
    transition: background 0.13s, border-color 0.13s;
  }
  .ask-sec:hover {
    background: var(--arc-primary-soft);
    border-color: var(--arc-primary);
  }
  .ask-sec.on {
    background: var(--arc-primary-soft);
    border-color: var(--arc-primary);
    color: var(--arc-primary-strong);
    font-weight: 500;
  }
  .ask-sec-tik {
    width: 18px;
    height: 18px;
    display: grid;
    place-items: center;
    border-radius: 5px;
    border: 1px solid var(--arc-border);
    background: var(--arc-surface);
    color: var(--arc-primary);
    font-weight: 700;
    font-size: 12px;
    flex-shrink: 0;
  }
  .ask-sec.on .ask-sec-tik {
    background: var(--arc-primary);
    border-color: var(--arc-primary);
    color: #fff;
  }
  .ask-sec-text {
    flex: 1;
  }
  .ask-serbest {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .ask-serbest-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--arc-text-faint);
  }
  .ask-serbest textarea {
    resize: vertical;
    min-height: 52px;
    font-family: inherit;
    font-size: 13.5px;
    padding: 9px 11px;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    background: var(--arc-surface-2);
    color: var(--arc-text);
    line-height: 1.5;
    outline: none;
    transition: border-color 0.13s;
  }
  .ask-serbest textarea:focus {
    border-color: var(--arc-primary);
  }
  .ask-bar {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  .ask-iptal,
  .ask-onay {
    padding: 8px 16px;
    border-radius: var(--arc-r-pill);
    border: 1px solid var(--arc-border);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.13s, color 0.13s, border-color 0.13s;
  }
  .ask-iptal {
    background: var(--arc-surface);
    color: var(--arc-text-soft);
  }
  .ask-iptal:hover {
    background: var(--arc-surface-2);
    color: var(--arc-text);
  }
  .ask-onay {
    background: var(--arc-primary);
    color: #fff;
    border-color: var(--arc-primary);
  }
  .ask-onay:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  .ask-onay:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
