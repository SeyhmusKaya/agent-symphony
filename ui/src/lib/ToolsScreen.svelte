<script lang="ts">
  import { onMount } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { toolsStore, type RepoTool } from "$lib/tools.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import Button from "$lib/ui/Button.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import { confirmDialog } from "$lib/ui/confirm";
  import { fmtDate } from "$lib/time";

  let arama = $state("");
  let formAcik = $state(false);

  // Form fields
  let fUrl = $state("");
  let fName = $state("");
  let fPurpose = $state("");
  let fCategory = $state("");
  let fTags = $state("");
  let formBusy = $state(false);

  // Search filter — works on name, purpose, category, tag and URL
  const filtered = $derived.by(() => {
    const q = arama.trim().toLowerCase();
    if (!q) return toolsStore.tools;
    return toolsStore.tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.purpose.toLowerCase().includes(q) ||
        (t.category ?? "").toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
        t.url.toLowerCase().includes(q),
    );
  });

  function resetForm() {
    fUrl = "";
    fName = "";
    fPurpose = "";
    fCategory = "";
    fTags = "";
  }

  function toggleForm() {
    formAcik = !formAcik;
    if (!formAcik) resetForm();
  }

  async function ekle() {
    if (!fUrl.trim() || !fName.trim()) return;
    formBusy = true;
    try {
      await toolsStore.ekle({
        url: fUrl,
        name: fName,
        purpose: fPurpose.trim(),
        category: fCategory.trim() || undefined,
        tags: fTags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      });
      resetForm();
      formAcik = false;
    } finally {
      formBusy = false;
    }
  }

  async function sil(tool: RepoTool) {
    if (!(await confirmDialog(`Delete "${tool.name}"?`, { danger: true, okLabel: "Delete" }))) return;
    await toolsStore.sil(tool.id);
  }

  async function linkAc(url: string) {
    try {
      await openUrl(url);
    } catch {
      /* fail silently */
    }
  }

  function formKapat() {
    formAcik = false;
    resetForm();
  }

  onMount(() => {
    void toolsStore.yukle();
  });
</script>

<div class="ts">
  <header class="ts-head">
    <div class="ts-head-id">
      <span class="arc-caption">Ecosystem</span>
      <div class="ts-title">Tools</div>
    </div>
    <div class="ts-head-actions">
      <button
        class="ts-refresh"
        title="Refresh"
        aria-label="Refresh"
        onclick={() => void toolsStore.yukle()}
      >
        <Icon name="refreshCw" size={14} stroke={2} />
      </button>
      <Button
        variant={formAcik ? "subtle" : "primary"}
        icon={formAcik ? "x" : "plus"}
        active={formAcik}
        onclick={toggleForm}
      >
        {formAcik ? "Cancel" : "Add repo"}
      </Button>
    </div>
  </header>

  <!-- Inline form: URL + name + purpose + category + tags -->
  {#if formAcik}
    <form
      class="ts-form-wrap"
      aria-label="Add repo form"
      onsubmit={(e) => {
        e.preventDefault();
        void ekle();
      }}
    >
      <div class="ts-form-card">
        <div class="ts-form-head">
          <Icon name="wrench" size={14} />
          <span>New Repo / Tool</span>
          <span class="ts-form-hint">Save with Enter · close with Esc</span>
        </div>
        <div class="ts-form-body">
          <div class="ts-row-2">
            <label class="ts-field">
              <span class="arc-caption">URL <span class="ts-req">*</span></span>
              <input
                class="arc-input"
                type="url"
                bind:value={fUrl}
                placeholder="https://github.com/org/repo"
                onkeydown={(e) => e.key === "Escape" && formKapat()}
              />
            </label>
            <label class="ts-field">
              <span class="arc-caption">Name <span class="ts-req">*</span></span>
              <input
                class="arc-input"
                type="text"
                bind:value={fName}
                placeholder="Repo name"
                onkeydown={(e) => e.key === "Escape" && formKapat()}
              />
            </label>
          </div>
          <label class="ts-field">
            <span class="arc-caption">Purpose</span>
            <textarea
              class="arc-input ts-textarea"
              rows={2}
              bind:value={fPurpose}
              placeholder="What is this repo / tool for?"
              onkeydown={(e) => e.key === "Escape" && formKapat()}
            ></textarea>
          </label>
          <div class="ts-row-2">
            <label class="ts-field">
              <span class="arc-caption">Category</span>
              <input
                class="arc-input"
                type="text"
                bind:value={fCategory}
                placeholder="frontend / backend / devops…"
                onkeydown={(e) => e.key === "Escape" && formKapat()}
              />
            </label>
            <label class="ts-field">
              <span class="arc-caption">Tags (comma-separated)</span>
              <input
                class="arc-input"
                type="text"
                bind:value={fTags}
                placeholder="typescript, vite, tailwind"
                onkeydown={(e) => e.key === "Escape" && formKapat()}
              />
            </label>
          </div>
        </div>
        <div class="ts-form-foot">
          <Button variant="ghost" onclick={formKapat}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            disabled={formBusy || !fUrl.trim() || !fName.trim()}
          >
            Add
          </Button>
        </div>
      </div>
    </form>
  {/if}

  <!-- Search bar + counter -->
  <div class="ts-bar">
    <div class="ts-search">
      <Icon name="search" size={15} class="ts-search-ic" />
      <input
        placeholder="Name, purpose, category, tag or URL…"
        bind:value={arama}
      />
    </div>
    <span class="ts-count">{filtered.length} repo</span>
  </div>

  <!-- List -->
  <div class="ts-body">
    {#if toolsStore.yukleniyor}
      <p class="ts-loading">Loading…</p>
    {:else if filtered.length === 0}
      <EmptyState
        icon="wrench"
        title="No tools yet"
        text={arama
          ? "No repos match your search."
          : "Add ecosystem repos or tools here."}
      />
    {:else}
      <div class="ts-grid">
        {#each filtered as tool (tool.id)}
          <article class="ts-card">
            <div class="tc-head">
              <div class="tc-title-row">
                <span class="tc-name">{tool.name}</span>
                {#if tool.category}
                  <span class="tc-cat">{tool.category}</span>
                {/if}
              </div>
              <button
                class="tc-del"
                title="Delete"
                aria-label="Delete"
                onclick={() => sil(tool)}
              >
                <Icon name="trash" size={13} />
              </button>
            </div>

            {#if tool.purpose}
              <p class="tc-purpose">{tool.purpose}</p>
            {/if}

            {#if tool.tags.length}
              <div class="tc-tags">
                {#each tool.tags as tag (tag)}
                  <span class="tc-tag">#{tag}</span>
                {/each}
              </div>
            {/if}

            <footer class="tc-foot">
              <span class="tc-meta">
                {tool.addedBy}
                <span class="tc-sep">·</span>
                {tool.source}
                <span class="tc-sep">·</span>
                {fmtDate(tool.updatedAt)}
              </span>
              <button
                class="tc-link"
                title="Go to repo"
                aria-label="Go to repo"
                onclick={() => linkAc(tool.url)}
              >
                <Icon name="share" size={12} />
                Repo
              </button>
            </footer>
          </article>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .ts {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--arc-bg);
  }

  /* ---- Header ---- */
  .ts-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: var(--arc-surface);
    border-bottom: 1px solid var(--arc-border);
  }
  .ts-head-id .arc-caption {
    font-size: 9.5px;
  }
  .ts-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--arc-text);
  }
  .ts-head-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ts-refresh {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: none;
    background: transparent;
    border-radius: var(--arc-r-sm);
    color: var(--arc-text-soft);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
  }
  .ts-refresh:hover {
    background: var(--arc-n100);
    color: var(--arc-primary);
  }

  /* ---- Inline form ---- */
  form.ts-form-wrap {
    flex-shrink: 0;
    padding: 14px 24px 4px;
    animation: ts-form-slide 0.16s var(--arc-ease, ease);
  }
  @keyframes ts-form-slide {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
  .ts-form-card {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-lg);
    box-shadow: var(--arc-shadow-sm);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .ts-form-head {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 600;
    color: var(--arc-text);
  }
  .ts-form-hint {
    margin-left: auto;
    font-size: 10.5px;
    font-weight: 400;
    color: var(--arc-text-faint);
  }
  .ts-form-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ts-row-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .ts-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ts-field .arc-caption {
    font-size: 10px;
  }
  .ts-req {
    color: var(--arc-danger, #dc2626);
    margin-left: 2px;
  }
  .ts-textarea {
    resize: vertical;
    min-height: 56px;
    font-family: inherit;
  }
  .ts-form-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 4px;
  }

  /* ---- Search bar ---- */
  .ts-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 24px 8px;
  }
  .ts-search {
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    padding: 0 11px;
    flex: 1;
    max-width: 400px;
  }
  .ts-search :global(.ts-search-ic) {
    color: var(--arc-text-faint);
    flex-shrink: 0;
  }
  .ts-search input {
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    font-size: 13px;
    padding: 8px 0;
    width: 100%;
    color: var(--arc-text);
  }
  .ts-search input::placeholder {
    color: var(--arc-text-faint);
  }
  .ts-count {
    font-size: 12px;
    color: var(--arc-text-faint);
    white-space: nowrap;
    margin-left: auto;
  }

  /* ---- Card list ---- */
  .ts-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 24px 28px;
    display: flex;
    flex-direction: column;
  }
  .ts-loading {
    color: var(--arc-text-soft);
    font-size: 13px;
    text-align: center;
    margin-top: 36px;
  }
  .ts-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
    align-content: start;
  }

  /* ---- Repo card ---- */
  .ts-card {
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-lg);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: transform 0.15s var(--arc-ease, ease),
      box-shadow 0.15s var(--arc-ease, ease),
      border-color 0.15s var(--arc-ease, ease);
  }
  .ts-card:hover {
    transform: translateY(-1px);
    box-shadow: var(--arc-shadow-sm);
    border-color: var(--arc-primary-soft);
  }
  .tc-head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .tc-title-row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .tc-name {
    font-size: 13.5px;
    font-weight: 600;
    color: var(--arc-text);
    word-break: break-word;
  }
  .tc-cat {
    font-size: 10px;
    font-weight: 600;
    background: var(--arc-primary-tint);
    color: var(--arc-primary-strong);
    border: 1px solid var(--arc-primary-soft);
    border-radius: var(--arc-r-pill);
    padding: 1px 8px;
    white-space: nowrap;
  }
  .tc-del {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    border: 1px solid transparent;
    border-radius: var(--arc-r-sm);
    background: transparent;
    color: var(--arc-text-faint);
    cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .tc-del:hover {
    background: var(--arc-danger-soft);
    border-color: var(--arc-danger, #dc2626);
    color: var(--arc-danger, #dc2626);
  }
  .tc-purpose {
    margin: 0;
    font-size: 12px;
    color: var(--arc-text-soft);
    line-height: 1.5;
    word-break: break-word;
  }
  .tc-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tc-tag {
    font-size: 10.5px;
    font-family: var(--arc-mono);
    background: var(--arc-n100);
    color: var(--arc-text-soft);
    border-radius: var(--arc-r-pill);
    padding: 2px 7px;
  }
  .tc-foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--arc-border);
    margin-top: auto;
  }
  .tc-meta {
    flex: 1;
    min-width: 0;
    font-size: 10.5px;
    color: var(--arc-text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tc-sep {
    margin: 0 2px;
    opacity: 0.5;
  }
  .tc-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--arc-primary);
    background: var(--arc-primary-tint);
    border: 1px solid var(--arc-primary-soft);
    border-radius: var(--arc-r-sm);
    padding: 4px 9px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s, border-color 0.12s;
    flex-shrink: 0;
  }
  .tc-link:hover {
    background: var(--arc-primary-soft);
    border-color: var(--arc-primary);
  }
</style>
