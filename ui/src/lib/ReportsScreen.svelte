<script lang="ts">
  import { onMount } from "svelte";
  import { listReports, readReport, openReportsDir, type ReportEntry, type Project } from "$lib/api";
  import { renderMarkdown } from "$lib/markdown";
  import Icon from "$lib/icons/Icon.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";

  let {
    onApprove,
    projects = [],
  }: {
    onApprove?: (text: string, project?: Project) => void;
    projects?: Project[];
  } = $props();

  // Only report-enabled projects + the selected project state
  const enabledProjects = $derived(projects.filter((p) => p.reportEnabled));
  let selectedProjectId = $state<string>("");

  let entries = $state<ReportEntry[]>([]);
  let loading = $state(true);
  let selected = $state<ReportEntry | null>(null);
  let body = $state<string>("");
  let dirPath = $state<string>("");

  // Extract the "## Iyilestirme onerileri" and "## Eski proje onerileri" sections
  // from the report body; each line becomes a suggestion card.
  // NOTE: the Turkish header strings in the regex below are parser-coupled with
  // the backend nightlyReport output and must NOT be translated.
  interface Oneri {
    metin: string;
    kaynak: "iyilestirme" | "eski-proje";
  }
  const oneriler = $derived<Oneri[]>(parseSuggestions(body));

  function parseSuggestions(md: string): Oneri[] {
    if (!md) return [];
    const out: Oneri[] = [];
    const sections: Array<[RegExp, Oneri["kaynak"]]> = [
      // Turkish (correct characters) and English variants
      [/##\s+(?:İyileştirme önerileri|Iyilestirme onerileri|Improvement suggestions?)\s*\n([\s\S]*?)(?=\n##\s|$)/i, "iyilestirme"],
      [/##\s+(?:Eski proje önerileri|Eski proje onerileri|Stale project suggestions?)\s*\n([\s\S]*?)(?=\n##\s|$)/i, "eski-proje"],
    ];
    for (const [re, kaynak] of sections) {
      const m = re.exec(md);
      if (!m) continue;
      const block = m[1];
      for (const line of block.split("\n")) {
        const t = line.replace(/^[-*\d.\s]+/, "").trim();
        if (!t || t.startsWith("_") || /^yok$/i.test(t)) continue;
        out.push({ metin: t, kaynak });
      }
    }
    return out;
  }

  function onayla(o: Oneri) {
    if (!onApprove) return;
    const proj = enabledProjects.find((p) => p.id === selectedProjectId);
    const projContext = proj
      ? `Apply the following improvement to the "${proj.name}" project and delegate it to the project chief:\n\n`
      : (o.kaynak === "eski-proje"
          ? "Stale project suggestion from the nightly report (auto-delegate):\n\n"
          : "Improvement suggestion from the nightly report (auto-delegate):\n\n");
    onApprove(projContext + o.metin, proj);
  }

  async function refresh() {
    loading = true;
    try {
      entries = await listReports();
      if (!selected && entries.length > 0) await pick(entries[0]);
    } finally {
      loading = false;
    }
  }

  async function pick(e: ReportEntry) {
    selected = e;
    body = "";
    try {
      body = await readReport(e.path);
    } catch (err) {
      body = `_Read error: ${(err as Error).message}_`;
    }
  }

  async function loadDirPath() {
    try {
      dirPath = await openReportsDir();
    } catch {
      /* noop */
    }
  }

  function fmtSize(n: number): string {
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  }

  onMount(async () => {
    await loadDirPath();
    await refresh();
  });
</script>

<div class="reports">
  <header class="rp-head">
    <div class="rp-head-id">
      <span class="arc-caption rp-cap">Reporting</span>
      <div class="rp-title">Daily reports</div>
    </div>
    <div class="rp-actions">
      <button class="rp-btn" onclick={refresh} title="Refresh">
        <Icon name="loader" size={13} stroke={2.2} />
        Refresh
      </button>
      {#if dirPath}
        <span class="rp-path" title={dirPath}>{dirPath}</span>
      {/if}
    </div>
  </header>

  <div class="rp-body">
    <aside class="rp-list">
      {#if loading}
        <p class="rp-muted">Loading…</p>
      {:else if entries.length === 0}
        <EmptyState
          icon="fileText"
          title="No reports yet"
          text="Reports are generated nightly around 04:00 from token/usage data."
          compact
        />
      {:else}
        {#each entries as e (e.path)}
          {@const isScan = e.date.startsWith("scan-")}
          <button
            class="rp-item"
            class:sel={selected?.path === e.path}
            class:scan={isScan}
            onclick={() => pick(e)}
          >
            <Icon name={isScan ? "sparkles" : "fileText"} size={13} stroke={2} />
            <span class="rp-date">{isScan ? e.date.replace(/^scan-/, "") : e.date}</span>
            {#if isScan}
              <span class="rp-tag">scan</span>
            {/if}
            <span class="rp-size">{fmtSize(e.size)}</span>
          </button>
        {/each}
      {/if}
    </aside>

    <section class="rp-view">
      {#if selected}
        <div class="rp-view-head">
          <span class="rp-view-date">{selected.date}</span>
          <span class="rp-view-path">{selected.path}</span>
        </div>
        {#if oneriler.length}
          <div class="rp-oneri-bar">
            <div class="rp-oneri-title">
              <Icon name="sparkles" size={13} stroke={2} />
              Quickly approvable suggestions ({oneriler.length})
            </div>
            {#if enabledProjects.length > 0}
              <div class="rp-proj-row">
                <Icon name="folder" size={12} stroke={2} />
                <span class="rp-proj-label">For which project?</span>
                <select class="rp-proj-sel" bind:value={selectedProjectId}>
                  <option value="">-- Let the Mimar choose --</option>
                  {#each enabledProjects as p (p.id)}
                    <option value={p.id}>{p.name}</option>
                  {/each}
                </select>
              </div>
            {:else}
              <div class="rp-proj-hint">
                <Icon name="info" size={12} stroke={2} />
                If you mark a project as "Report-enabled" in the project list, suggestions are sent directly to that project.
              </div>
            {/if}
            <div class="rp-oneri-list">
              {#each oneriler as o, i (i)}
                <div class="rp-oneri" class:eski={o.kaynak === "eski-proje"}>
                  <span class="rp-oneri-text">{o.metin}</span>
                  <button class="rp-oneri-btn" onclick={() => onayla(o)} disabled={!onApprove}>
                    Approve
                  </button>
                </div>
              {/each}
            </div>
          </div>
        {/if}
        <div class="rp-view-body md">
          {@html renderMarkdown(body)}
        </div>
      {:else if !loading}
        <EmptyState icon="fileText" title="Select a report" text="Pick a date on the left." />
      {/if}
    </section>
  </div>
</div>

<style>
  .reports {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--arc-surface-2);
  }
  .rp-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 24px;
    background: var(--arc-surface);
    border-bottom: 1px solid var(--arc-border);
  }
  .rp-head-id {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .rp-cap {
    font-size: 9.5px;
  }
  .rp-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--arc-text);
  }
  .rp-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .rp-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: 1px solid var(--arc-border);
    background: var(--arc-surface-2);
    color: var(--arc-text-soft);
    border-radius: var(--arc-r-sm);
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .rp-btn:hover {
    border-color: var(--arc-primary);
    color: var(--arc-primary);
  }
  .rp-path {
    font-size: 11px;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
    max-width: 360px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rp-body {
    flex: 1;
    display: grid;
    grid-template-columns: 260px 1fr;
    min-height: 0;
  }
  .rp-list {
    border-right: 1px solid var(--arc-border);
    background: var(--arc-surface);
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .rp-item {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px solid transparent;
    background: transparent;
    border-radius: var(--arc-r-sm);
    padding: 8px 10px;
    cursor: pointer;
    color: var(--arc-text-soft);
    transition: background 0.1s, border-color 0.1s, color 0.1s;
  }
  .rp-item:hover {
    background: var(--arc-surface-2);
  }
  .rp-item.sel {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
    border-color: var(--arc-primary);
  }
  .rp-date {
    font-family: var(--arc-mono);
    font-weight: 600;
    flex: 1;
  }
  .rp-size {
    font-size: 10.5px;
    color: var(--arc-text-faint);
  }
  .rp-tag {
    font-size: 9.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }
  .rp-item.scan .rp-date {
    color: var(--arc-primary-strong);
  }
  .rp-muted {
    color: var(--arc-text-soft);
    font-size: 12px;
    padding: 10px;
  }

  .rp-view {
    overflow-y: auto;
    padding: 24px 28px 60px;
    background: var(--arc-bg);
  }
  .rp-oneri-bar {
    border: 1px solid var(--arc-border);
    background: linear-gradient(135deg, var(--arc-primary-soft) 0%, var(--arc-surface) 100%);
    border-radius: var(--arc-r);
    padding: 14px 16px;
    margin-bottom: 20px;
  }
  .rp-proj-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    padding: 8px 10px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
  }
  .rp-proj-label {
    font-size: 12px;
    color: var(--arc-text-soft);
    white-space: nowrap;
  }
  .rp-proj-sel {
    flex: 1;
    font-size: 12.5px;
    padding: 4px 8px;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    background: var(--arc-surface-2);
    color: var(--arc-text);
    cursor: pointer;
    outline: none;
  }
  .rp-proj-sel:focus {
    border-color: var(--arc-primary);
  }
  .rp-proj-hint {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 11.5px;
    color: var(--arc-text-soft);
    padding: 8px 10px;
    background: var(--arc-surface);
    border: 1px dashed var(--arc-border);
    border-radius: var(--arc-r-sm);
    margin-bottom: 12px;
    line-height: 1.5;
  }
  .rp-oneri-title {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--arc-primary-strong);
    font-weight: 600;
    margin-bottom: 10px;
  }
  .rp-oneri-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .rp-oneri {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    box-shadow: var(--arc-shadow-sm);
    transition: transform 0.12s var(--arc-ease), box-shadow 0.12s var(--arc-ease);
  }
  .rp-oneri:hover {
    transform: translateY(-1px);
    box-shadow: var(--arc-shadow-md, 0 4px 14px rgba(0,0,0,0.07));
  }
  .rp-oneri.eski {
    border-left: 3px solid var(--arc-warn, #f59e0b);
  }
  .rp-oneri-text {
    flex: 1;
    font-size: 13px;
    color: var(--arc-text);
    line-height: 1.45;
  }
  .rp-oneri-btn {
    padding: 6px 14px;
    border: 1px solid var(--arc-primary);
    background: var(--arc-primary);
    color: white;
    border-radius: var(--arc-r-sm);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.12s, transform 0.08s;
  }
  .rp-oneri-btn:hover:not(:disabled) {
    background: var(--arc-primary-strong, var(--arc-primary));
    transform: translateY(-1px);
  }
  .rp-oneri-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .rp-view-head {
    margin-bottom: 14px;
    border-bottom: 1px solid var(--arc-border);
    padding-bottom: 10px;
    display: flex;
    align-items: baseline;
    gap: 14px;
  }
  .rp-view-date {
    font-size: 18px;
    font-weight: 700;
    font-family: var(--arc-mono);
    color: var(--arc-text);
  }
  .rp-view-path {
    font-size: 10.5px;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
  }
  .rp-view-body :global(h1),
  .rp-view-body :global(h2),
  .rp-view-body :global(h3) {
    font-weight: 600;
    margin: 18px 0 8px;
  }
  .rp-view-body :global(h1) {
    font-size: 22px;
  }
  .rp-view-body :global(h2) {
    font-size: 17px;
    color: var(--arc-primary-strong);
  }
  .rp-view-body :global(p) {
    line-height: 1.7;
    margin: 9px 0;
  }
  .rp-view-body :global(table) {
    border-collapse: collapse;
    margin: 14px 0;
    font-size: 12.5px;
  }
  .rp-view-body :global(th),
  .rp-view-body :global(td) {
    border: 1px solid var(--arc-border);
    padding: 5px 10px;
    text-align: left;
  }
  .rp-view-body :global(th) {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }
  .rp-view-body :global(code) {
    font-family: var(--arc-mono);
    background: var(--arc-n100);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 12px;
  }
  .rp-view-body :global(pre) {
    background: var(--arc-n900);
    border-radius: var(--arc-r-sm);
    padding: 14px 15px;
    overflow-x: auto;
    margin: 12px 0;
  }
  .rp-view-body :global(pre code) {
    background: none;
    padding: 0;
    color: #e5e8ec;
  }
  /* ---- Code block copy button (Claude Code style) ---- */
  .rp-view-body :global(.code-block) {
    position: relative;
  }
  .rp-view-body :global(.code-copy) {
    position: absolute;
    top: 7px;
    right: 7px;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    padding: 0;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.08);
    cursor: pointer;
    opacity: 0;
    transition:
      opacity 0.15s var(--arc-ease),
      background 0.15s var(--arc-ease),
      border-color 0.15s var(--arc-ease);
  }
  .rp-view-body :global(.code-block:hover .code-copy),
  .rp-view-body :global(.code-copy:focus-visible) {
    opacity: 1;
  }
  .rp-view-body :global(.code-copy:hover) {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.28);
  }
  .rp-view-body :global(.code-copy)::before {
    content: "";
    width: 14px;
    height: 14px;
    background-color: #cbd5e1;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='9' y='9' width='13' height='13' rx='2'/%3E%3Cpath d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='9' y='9' width='13' height='13' rx='2'/%3E%3Cpath d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/%3E%3C/svg%3E") center / contain no-repeat;
  }
  .rp-view-body :global(.code-copy.copied) {
    opacity: 1;
    background: rgba(52, 211, 153, 0.16);
    border-color: rgba(52, 211, 153, 0.5);
  }
  .rp-view-body :global(.code-copy.copied)::before {
    background-color: #34d399;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E") center / contain no-repeat;
  }
</style>
