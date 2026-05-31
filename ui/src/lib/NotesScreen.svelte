<script lang="ts">
  import { onMount } from "svelte";
  import { invoke } from "@tauri-apps/api/core";
  import { confirmDialog } from "$lib/ui/confirm";
  import { notesStore, autoTitleAndTags, type Note } from "$lib/notes.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import Button from "$lib/ui/Button.svelte";
  import EmptyState from "$lib/ui/EmptyState.svelte";
  import BlockEditor from "$lib/ui/BlockEditor.svelte";
  import NoteCard from "$lib/notes/NoteCard.svelte";
  import {
    escapeHtml,
    extractImagesFromHtml,
    fileToBase64,
    plainTextToBlockHtml,
  } from "$lib/notes/helpers.js";

  interface Proje {
    id: string;
    name: string;
  }

  let projeler = $state<Proje[]>([]);
  let aktifKapsam = $state("__tum__");
  let arama = $state("");

  let modalAcik = $state(false);
  let duzenlenenId = $state<string | null>(null);
  let modalKey = $state(0); // increments on each open, recreates the BlockEditor
  let mBaslik = $state("");
  let mIcerikText = $state(""); // plain text mirror
  let mIcerikHtml = $state(""); // tiptap html
  let mKapsam = $state("genel");
  let mEtiket = $state("");
  let aiRunning = $state(false);
  let aiUserEditedTitle = $state(false);

  const DRAFT_KEY = "ns_hizli_draft";

  function loadDraft() {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as { baslik?: string; icerik?: string; images?: string[] };
      hizliBaslik = d.baslik ?? "";
      hizliIcerik = d.icerik ?? "";
      hizliImages = Array.isArray(d.images) ? d.images : [];
    } catch { /* ignore */ }
  }

  function saveDraft() {
    try {
      if (!hizliBaslik && !hizliIcerik && hizliImages.length === 0) {
        localStorage.removeItem(DRAFT_KEY);
      } else {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ baslik: hizliBaslik, icerik: hizliIcerik, images: hizliImages }));
      }
    } catch { /* ignore */ }
  }

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
  }

  let hizliBaslik = $state("");
  let hizliIcerik = $state("");
  let hizliImages = $state<string[]>([]);

  let recording = $state(false);
  let speechAvailable = $state(false);
  let micHedef: "hizli" | "modal" = "hizli";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let recognition: any = null;

  function setupSpeech() {
    const w = window as unknown as Record<string, unknown>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    speechAvailable = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new (Ctor as any)();
    rec.lang = "tr-TR";
    rec.interimResults = true;
    rec.continuous = true;
    let base = "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      const val = (base ? base + " " : "") + text;
      if (micHedef === "hizli") hizliIcerik = val;
      else mIcerikText = val;
    };
    rec.onstart = () => {
      base = (micHedef === "hizli" ? hizliIcerik : mIcerikText).trim();
      recording = true;
    };
    rec.onend = () => (recording = false);
    rec.onerror = () => (recording = false);
    recognition = rec;
  }

  function toggleMic(hedef: "hizli" | "modal") {
    if (!recognition) return;
    if (recording) {
      recognition.stop();
      return;
    }
    micHedef = hedef;
    recognition.start();
  }

  // Save to localStorage when hizliBaslik/hizliIcerik/hizliImages change.
  // Svelte 5 $effect: automatically tracks the reactive values inside.
  $effect(() => {
    void hizliBaslik;
    void hizliIcerik;
    void hizliImages;
    saveDraft();
  });

  onMount(async () => {
    loadDraft(); // Restore the draft first
    setupSpeech();
    await notesStore.yukle();
    try {
      projeler = await invoke<Proje[]>("list_projects");
    } catch {
      projeler = [];
    }
  });

  const gosterilen = $derived.by(() => {
    let list = notesStore.notes;
    if (aktifKapsam === "genel") list = list.filter((n) => n.kapsam === "genel");
    else if (aktifKapsam !== "__tum__")
      list = list.filter((n) => n.kapsam === aktifKapsam);
    const q = arama.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (n) =>
          n.baslik.toLowerCase().includes(q) ||
          n.icerik.toLowerCase().includes(q) ||
          n.etiketler.some((e) => e.toLowerCase().includes(q)) ||
          (n.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    return list;
  });

  const sabitler = $derived(gosterilen.filter((n) => n.sabitli && !n.cozuldu));
  const digerleri = $derived(gosterilen.filter((n) => !n.sabitli && !n.cozuldu));
  const cozulenler = $derived(gosterilen.filter((n) => !!n.cozuldu));

  // per-project counts for sidebar
  const projeCounts = $derived.by(() => {
    const map = new Map<string, number>();
    let genel = 0;
    for (const n of notesStore.notes) {
      if (n.kapsam === "genel") genel += 1;
      else map.set(n.kapsam, (map.get(n.kapsam) ?? 0) + 1);
    }
    return { map, genel, total: notesStore.notes.length };
  });

  function kapsamAdi(id: string): string {
    if (id === "genel") return "General";
    return projeler.find((p) => p.id === id)?.name ?? id;
  }

  function yeniNot(kapsamOverride?: string) {
    duzenlenenId = null;
    mBaslik = "";
    mIcerikText = "";
    mIcerikHtml = "";
    mKapsam =
      kapsamOverride ?? (aktifKapsam === "__tum__" ? "genel" : aktifKapsam);
    mEtiket = "";
    aiUserEditedTitle = false;
    modalKey += 1;
    modalAcik = true;
  }

  function duzenle(n: Note) {
    duzenlenenId = n.id;
    mBaslik = n.baslik;
    mIcerikText = n.icerik;
    // Old notes have no bodyHtml — convert plain text to HTML and hand it to the
    // editor, otherwise the window opens completely empty.
    let html = "";
    if (n.bodyHtml && n.bodyHtml.trim()) {
      html = n.bodyHtml;
    } else if (n.icerik && n.icerik.trim()) {
      html = plainTextToBlockHtml(n.icerik);
    }
    // Old quick notes did not carry bodyHtml — images[] is filled but not in html.
    // Add only the src values not already in the HTML (avoids duplicates).
    if (n.images && n.images.length > 0) {
      const existing = new Set(extractImagesFromHtml(html));
      const missing = n.images.filter((s) => !existing.has(s));
      if (missing.length > 0) {
        html += missing.map((src) => `<p><img src="${escapeHtml(src)}" /></p>`).join("");
      }
    }
    mIcerikHtml = html;
    mKapsam = n.kapsam;
    mEtiket = [...(n.etiketler ?? []), ...(n.tags ?? [])].join(", ");
    aiUserEditedTitle = true; // existing notes: don't auto-overwrite
    modalKey += 1;
    modalAcik = true;
  }

  // NOTE: the escapeHtml / extractImagesFromHtml / fileToBase64 / preview / fmtTarih
  // helpers were moved into the $lib/notes/helpers.ts module (shared with NoteCard).

  function onEditorChange(html: string, text: string) {
    mIcerikHtml = html;
    mIcerikText = text;
  }

  async function maybeAutoTitle(noteId: string, hadTitle: boolean, text: string) {
    if (text.trim().length <= 50) return;
    aiRunning = true;
    try {
      const r = await autoTitleAndTags(text);
      if (!r) return;
      const patch: Parameters<typeof notesStore.guncelle>[1] = {
        autoTitled: true,
        tags: r.tags,
      };
      if (!hadTitle) patch.baslik = r.title;
      await notesStore.guncelle(noteId, patch);
    } finally {
      aiRunning = false;
    }
  }

  async function kaydet() {
    const userTitle = mBaslik.trim();
    const baslik = userTitle || "Untitled";
    const etiketler = mEtiket
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    const projectId = mKapsam !== "genel" ? mKapsam : undefined;
    // Extract all images from the BlockEditor as images[] — card thumbnails are
    // rendered from this field; they are not lost after editing either.
    const extracted = extractImagesFromHtml(mIcerikHtml);
    const images = extracted.length > 0 ? extracted : undefined;
    if (duzenlenenId) {
      await notesStore.guncelle(duzenlenenId, {
        baslik,
        icerik: mIcerikText,
        bodyHtml: mIcerikHtml,
        images,
        etiketler,
        kapsam: mKapsam,
        kapsamAd: kapsamAdi(mKapsam),
        projectId,
      });
      modalAcik = false;
    } else {
      const id = await notesStore.ekle({
        baslik,
        icerik: mIcerikText,
        bodyHtml: mIcerikHtml,
        images,
        kapsam: mKapsam,
        kapsamAd: kapsamAdi(mKapsam),
        etiketler,
        projectId,
      });
      modalAcik = false;
      // fire-and-forget AI auto-title
      void maybeAutoTitle(id, !!userTitle, mIcerikText);
    }
  }

  function hizliPickImage() {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.multiple = true;
    inp.onchange = async () => {
      if (!inp.files) return;
      for (const f of Array.from(inp.files)) {
        const b64 = await fileToBase64(f);
        hizliImages = [...hizliImages, b64];
      }
    };
    inp.click();
  }

  function hizliRemoveImage(i: number) {
    hizliImages = hizliImages.filter((_, idx) => idx !== i);
  }

  async function handleHizliPaste(e: ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const it of Array.from(items)) {
      if (it.kind === "file" && it.type.startsWith("image/")) {
        e.preventDefault();
        const file = it.getAsFile();
        if (file) {
          const b64 = await fileToBase64(file);
          hizliImages = [...hizliImages, b64];
        }
      }
    }
  }

  async function hizliKaydet() {
    if (!hizliBaslik.trim() && !hizliIcerik.trim() && hizliImages.length === 0) return;
    const kapsam =
      aktifKapsam === "__tum__" || aktifKapsam === "genel" ? "genel" : aktifKapsam;
    const userTitle = hizliBaslik.trim();
    const text = hizliIcerik;
    const images = hizliImages.length > 0 ? [...hizliImages] : undefined;
    const id = await notesStore.ekle({
      baslik: userTitle || "Quick note",
      icerik: text,
      images,
      kapsam,
      kapsamAd: kapsam === "genel" ? "General" : kapsamAdi(kapsam),
      etiketler: [],
      projectId: kapsam !== "genel" ? kapsam : undefined,
    });
    hizliBaslik = "";
    hizliIcerik = "";
    hizliImages = [];
    clearDraft();
    void maybeAutoTitle(id, !!userTitle, text);
  }

  async function pinle(n: Note) {
    await notesStore.guncelle(n.id, { sabitli: !n.sabitli });
  }

  async function coz(n: Note) {
    await notesStore.guncelle(n.id, { cozuldu: !n.cozuldu });
  }

  async function sil(n: Note) {
    const ok = await confirmDialog(`Delete "${n.baslik}"?`, {
      title: "Delete note",
      danger: true,
      okLabel: "Delete",
    });
    if (ok) await notesStore.sil(n.id);
  }

  function hizliKey(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void hizliKaydet();
    }
  }
</script>

<div class="ns">
  <header class="ns-head">
    <div class="ns-head-id">
      <span class="arc-caption">Workspace</span>
      <div class="ns-title">Notes</div>
    </div>
    <Button variant="primary" icon="plus" onclick={() => yeniNot()}>New note</Button>
  </header>

  <div class="ns-layout">
    <aside class="ns-side">
      <div class="ns-side-cap">
        <span class="arc-caption">Library</span>
      </div>
      <button class="ns-side-item" class:active={aktifKapsam === "__tum__"} onclick={() => (aktifKapsam = "__tum__")}>
        <Icon name="layoutGrid" size={13} />
        <span class="ns-side-label">All notes</span>
        <span class="ns-side-count">{projeCounts.total}</span>
      </button>
      <button class="ns-side-item" class:active={aktifKapsam === "genel"} onclick={() => (aktifKapsam = "genel")}>
        <Icon name="fileText" size={13} />
        <span class="ns-side-label">General</span>
        <span class="ns-side-count">{projeCounts.genel}</span>
      </button>

      <div class="ns-side-cap ns-side-cap-mid">
        <span class="arc-caption">Projects</span>
      </div>
      {#if projeler.length === 0}
        <div class="ns-side-empty">No projects yet</div>
      {:else}
        {#each projeler as p (p.id)}
          <div class="ns-side-row">
            <button class="ns-side-item flex" class:active={aktifKapsam === p.id} onclick={() => (aktifKapsam = p.id)}>
              <Icon name="folder" size={13} />
              <span class="ns-side-label">{p.name}</span>
              <span class="ns-side-count">{projeCounts.map.get(p.id) ?? 0}</span>
            </button>
            <button class="ns-side-add" title="New note in {p.name}" onclick={() => yeniNot(p.id)}>
              <Icon name="plus" size={12} />
            </button>
          </div>
        {/each}
      {/if}
    </aside>

    <div class="ns-main">
      <div class="ns-quick">
          <div class="ns-quick-card" onpaste={handleHizliPaste}>
          <input
            class="ns-q-baslik"
            placeholder="Quick note title…"
            bind:value={hizliBaslik}
            onkeydown={hizliKey}
          />
          <div class="ns-q-divider"></div>
          <input
            class="ns-q-icerik"
            placeholder="Type or speak what's on your mind — Ctrl+Enter to save, Ctrl+V to paste image"
            bind:value={hizliIcerik}
            onkeydown={hizliKey}
          />
          {#if hizliImages.length > 0}
            <div class="ns-q-imgs">
              {#each hizliImages as src, i (i)}
                <div class="ns-q-img-wrap">
                  <img class="ns-q-img" {src} alt="attachment" />
                  <button class="ns-q-img-del" title="Remove" onclick={() => hizliRemoveImage(i)}>
                    <Icon name="x" size={10} />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
          <div class="ns-q-actions">
            <button class="ns-q-img-btn" title="Add image" onclick={hizliPickImage}>
              <Icon name="image" size={14} />
            </button>
            {#if speechAvailable}
              <button
                class="ns-mic"
                class:rec={recording}
                title={recording ? "Stop listening" : "Voice note"}
                aria-label="Voice note"
                onclick={() => toggleMic("hizli")}
              >
                <Icon name={recording ? "square" : "mic"} size={15} />
              </button>
            {/if}
            <span class="ns-q-spacer"></span>
            <Button variant="primary" size="sm" onclick={hizliKaydet}>Save</Button>
          </div>
        </div>
      </div>

      <div class="ns-bar">
        <div class="ns-bar-info">
          <span class="arc-caption">{kapsamAdi(aktifKapsam === "__tum__" ? "genel" : aktifKapsam)}</span>
          <span class="ns-bar-count">{gosterilen.length} notes</span>
        </div>
        <div class="ns-search">
          <Icon name="search" size={15} class="ns-search-ic" />
          <input placeholder="Search notes…" bind:value={arama} />
        </div>
        <button
          class="ns-refresh"
          title="Refresh"
          onclick={() => notesStore.yukle()}
        >
          <Icon name="refreshCw" size={14} stroke={2} />
        </button>
      </div>

      <div class="ns-body">
        {#if notesStore.yukleniyor}
          <p class="ns-loading">Loading…</p>
        {:else if gosterilen.length === 0}
          <EmptyState
            icon="fileText"
            title="No notes"
            text="Add a quick note above or create a new note."
          />
        {:else}
          {#if sabitler.length}
            <div class="ns-section-cap">
              <Icon name="pin" size={12} />
              <span class="arc-caption">Pinned</span>
            </div>
            <div class="ns-grid">
              {#each sabitler as n (n.id)}
                <NoteCard note={n} onPin={pinle} onEdit={duzenle} onDelete={sil} onCoz={coz} />
              {/each}
            </div>
          {/if}
          {#if digerleri.length}
            {#if sabitler.length}
              <div class="ns-section-cap">
                <Icon name="fileText" size={12} />
                <span class="arc-caption">All notes</span>
              </div>
            {/if}
            <div class="ns-grid">
              {#each digerleri as n (n.id)}
                <NoteCard note={n} onPin={pinle} onEdit={duzenle} onDelete={sil} onCoz={coz} />
              {/each}
            </div>
          {/if}
          {#if cozulenler.length}
            <div class="ns-section-cap ns-section-cap-resolved">
              <Icon name="check" size={12} />
              <span class="arc-caption">Resolved</span>
              <span class="ns-resolved-count">{cozulenler.length}</span>
            </div>
            <div class="ns-grid">
              {#each cozulenler as n (n.id)}
                <NoteCard note={n} onPin={pinle} onEdit={duzenle} onDelete={sil} onCoz={coz} />
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>

{#if modalAcik}
  <div
    class="ns-modal-bg"
    role="button"
    tabindex="-1"
    aria-label="Close"
    onclick={() => (modalAcik = false)}
    onkeydown={(e) => e.key === "Escape" && (modalAcik = false)}
  >
    <div
      class="ns-modal"
      role="dialog"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={() => {}}
    >
      <div class="ns-modal-head">
        <span>{duzenlenenId ? "Edit note" : "New note"}</span>
        {#if aiRunning}
          <span class="ns-ai-pill"><Icon name="sparkles" size={11} /> AI…</span>
        {/if}
      </div>
      <input
        class="arc-input ns-w"
        placeholder="Title (leave blank to auto-generate)"
        bind:value={mBaslik}
        oninput={() => (aiUserEditedTitle = true)}
      />
      {#key modalKey}
        <BlockEditor
          value={mIcerikHtml}
          onChange={onEditorChange}
          placeholder="Type '/' for blocks…"
        />
      {/key}
      {#if speechAvailable}
        <div class="ns-mic-row">
          <button
            class="ns-mic ns-mic-inline"
            class:rec={recording}
            title={recording ? "Stop listening" : "Voice input"}
            aria-label="Voice input"
            onclick={() => toggleMic("modal")}
          >
            <Icon name={recording ? "square" : "mic"} size={14} />
          </button>
          <span class="ns-mic-hint">Voice input appends plain text — toggle off when done.</span>
        </div>
      {/if}
      <label class="ns-field">
        <span class="arc-caption">Project</span>
        <select class="arc-input ns-w" bind:value={mKapsam}>
          <option value="genel">General</option>
          {#each projeler as p (p.id)}
            <option value={p.id}>{p.name}</option>
          {/each}
        </select>
      </label>
      <label class="ns-field">
        <span class="arc-caption">Tags</span>
        <input class="arc-input ns-w" placeholder="comma-separated" bind:value={mEtiket} />
      </label>
      <div class="ns-modal-foot">
        <Button variant="ghost" onclick={() => (modalAcik = false)}>Cancel</Button>
        <Button variant="primary" onclick={kaydet}>Save</Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .ns {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--arc-bg);
  }

  .ns-head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    background: var(--arc-surface);
    border-bottom: 1px solid var(--arc-border);
  }
  .ns-head-id .arc-caption {
    font-size: 9.5px;
  }
  .ns-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--arc-text);
  }

  .ns-layout {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 220px 1fr;
  }

  .ns-side {
    border-right: 1px solid var(--arc-border);
    background: var(--arc-surface);
    overflow-y: auto;
    padding: 14px 10px 18px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ns-side-cap {
    padding: 6px 10px 4px;
  }
  .ns-side-cap-mid {
    margin-top: 12px;
  }
  .ns-side-empty {
    padding: 4px 12px;
    color: var(--arc-text-faint);
    font-size: 11.5px;
  }
  .ns-side-item {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    border: none;
    background: transparent;
    border-radius: 8px;
    padding: 7px 10px;
    font: inherit;
    font-size: 12.5px;
    color: var(--arc-text-soft);
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }
  .ns-side-item:hover {
    background: var(--arc-primary-tint);
    color: var(--arc-primary-strong);
  }
  .ns-side-item.active {
    background: var(--arc-primary);
    color: #fff;
  }
  .ns-side-label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ns-side-count {
    font-size: 10.5px;
    font-weight: 600;
    color: inherit;
    opacity: 0.7;
  }
  .ns-side-row {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .ns-side-row .ns-side-item {
    flex: 1;
  }
  .ns-side-add {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--arc-text-faint);
    border-radius: 6px;
    cursor: pointer;
    margin-right: 2px;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .ns-side-add:hover {
    border-color: var(--arc-primary);
    color: var(--arc-primary);
    background: var(--arc-primary-tint);
  }

  .ns-main {
    display: flex;
    flex-direction: column;
    min-height: 0;
    min-width: 0;
  }

  .ns-quick {
    flex-shrink: 0;
    padding: 14px 24px 4px;
  }
  .ns-quick-card {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r);
    box-shadow: var(--arc-shadow-sm);
    padding: 7px 8px 7px 14px;
  }
  .ns-q-divider {
    width: 1px;
    height: 22px;
    background: var(--arc-border);
    flex-shrink: 0;
  }
  .ns-q-baslik {
    width: 210px;
    flex-shrink: 0;
  }
  .ns-q-icerik {
    flex: 1;
    min-width: 0;
  }
  .ns-q-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 4px;
    margin-top: 0;
    border-top: 1px solid var(--arc-border);
    flex-basis: 100%;
    width: 100%;
  }
  .ns-q-spacer {
    flex: 1;
  }
  .ns-q-img-btn {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    background: transparent;
    color: var(--arc-text-soft);
    transition: border-color 0.15s, color 0.15s;
    cursor: pointer;
    flex-shrink: 0;
  }
  .ns-q-img-btn:hover {
    border-color: var(--arc-primary);
    color: var(--arc-primary);
  }
  .ns-q-imgs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 0 2px;
    flex-basis: 100%;
    width: 100%;
  }
  .ns-q-img-wrap {
    position: relative;
  }
  .ns-q-img {
    width: 72px;
    height: 72px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid var(--arc-border);
    display: block;
  }
  .ns-q-img-del {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(0,0,0,0.55);
    border: none;
    color: #fff;
    display: grid;
    place-items: center;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }
  /* .note-imgs / .note-img-thumb / .note-img-more were moved to NoteCard.svelte. */
  .ns-quick-card input {
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    font-size: 13px;
    color: var(--arc-text);
    padding: 6px 0;
  }
  .ns-quick-card input::placeholder {
    color: var(--arc-text-faint);
  }

  .ns-mic {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    background: var(--arc-surface);
    color: var(--arc-text-soft);
    transition: border-color 0.15s var(--arc-ease), color 0.15s var(--arc-ease);
  }
  .ns-mic:hover {
    border-color: var(--arc-primary);
    color: var(--arc-primary);
  }
  .ns-mic.rec {
    background: var(--arc-danger);
    border-color: var(--arc-danger);
    color: #fff;
    animation: ns-pulse 1.2s var(--arc-ease) infinite;
  }
  @keyframes ns-pulse {
    50% {
      box-shadow: 0 0 0 5px rgba(220, 38, 38, 0.18);
    }
  }

  .ns-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 14px 24px 10px;
  }
  .ns-bar-info {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }
  .ns-bar-count {
    font-size: 12px;
    color: var(--arc-text-faint);
  }
  .ns-search {
    display: flex;
    align-items: center;
    gap: 7px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    padding: 0 11px;
    width: 240px;
  }
  .ns-search :global(.ns-search-ic) {
    color: var(--arc-text-faint);
    flex-shrink: 0;
  }
  .ns-search input {
    border: none;
    outline: none;
    background: transparent;
    font: inherit;
    font-size: 13px;
    padding: 8px 0;
    width: 100%;
    color: var(--arc-text);
  }
  .ns-refresh {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    background: transparent;
    border-radius: var(--arc-r-sm);
    color: var(--arc-text-soft);
    cursor: pointer;
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }
  .ns-refresh:hover {
    background: var(--arc-surface-hover);
    color: var(--arc-primary);
  }

  .ns-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 24px 28px;
    display: flex;
    flex-direction: column;
  }
  .ns-loading {
    color: var(--arc-text-soft);
    font-size: 13px;
    text-align: center;
    margin-top: 36px;
  }
  .ns-section-cap {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--arc-text-faint);
    margin: 14px 2px 10px;
  }
  .ns-section-cap:first-child {
    margin-top: 4px;
  }
  .ns-section-cap-resolved {
    color: #16a34a;
    opacity: 0.8;
  }
  .ns-resolved-count {
    font-size: 11px;
    font-weight: 600;
    font-family: var(--arc-mono);
    margin-left: 2px;
  }
  .ns-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
    gap: 13px;
  }

  /* NOTE: .note and its sub-classes (.note-top/.note-baslik/.note-icerik/
     .note-imgs/.note-tags/.note-time/.note-coz/.na) were moved into
     $lib/notes/NoteCard.svelte (scoped). */

  .ns-modal-bg {
    position: fixed;
    inset: 0;
    background: rgba(23, 26, 33, 0.4);
    backdrop-filter: blur(1.5px);
    display: grid;
    place-items: center;
    z-index: 50;
    animation: ns-fade 0.16s var(--arc-ease);
  }
  @keyframes ns-fade {
    from {
      opacity: 0;
    }
  }
  .ns-modal {
    width: 640px;
    max-width: 94vw;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-lg);
    box-shadow: var(--arc-shadow-lg);
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 11px;
    max-height: 90vh;
    overflow-y: auto;
  }
  .ns-modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 16px;
    font-weight: 600;
    color: var(--arc-text);
  }
  .ns-ai-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    font-weight: 600;
    color: var(--arc-primary-strong);
    background: var(--arc-primary-soft);
    border-radius: var(--arc-r-pill);
    padding: 3px 8px;
  }
  .ns-w {
    width: 100%;
  }
  .ns-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .ns-mic-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ns-mic-inline {
    width: 32px;
    height: 30px;
  }
  .ns-mic-hint {
    font-size: 11px;
    color: var(--arc-text-faint);
  }
  .ns-modal-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
</style>
