<script lang="ts">
  // ui/src/lib/notes/NoteCard.svelte — renders a single note card.
  // The component version of the old NotesScreen notCard snippet — pin/edit/
  // delete/resolve actions are passed to the parent via callbacks.
  import Icon from "$lib/icons/Icon.svelte";
  import type { Note } from "$lib/notes.svelte";
  import { preview, fmtTarih } from "./helpers.js";

  let {
    note,
    onPin,
    onEdit,
    onDelete,
    onCoz,
  }: {
    note: Note;
    onPin: (n: Note) => void;
    onEdit: (n: Note) => void;
    onDelete: (n: Note) => void;
    onCoz: (n: Note) => void;
  } = $props();
</script>

<article class="note" class:pin={note.sabitli} class:cozuldu={note.cozuldu}>
  <div class="note-top">
    <span class="note-badge">{note.kapsamAd}</span>
    <div class="note-actions">
      <button class="na" class:on={note.sabitli} title="Pin" onclick={() => onPin(note)}>
        <Icon name="pin" size={13} />
      </button>
      <button class="na" title="Edit" onclick={() => onEdit(note)}>
        <Icon name="edit" size={13} />
      </button>
      <button class="na del" title="Delete" onclick={() => onDelete(note)}>
        <Icon name="trash2" size={13} />
      </button>
    </div>
  </div>
  <div class="note-baslik">{note.baslik}</div>
  {#if preview(note)}
    <div class="note-icerik">{preview(note)}</div>
  {/if}
  {#if note.images && note.images.length > 0}
    <div class="note-imgs">
      {#each note.images.slice(0, 3) as src, i (i)}
        <img class="note-img-thumb" {src} alt="attachment" />
      {/each}
      {#if note.images.length > 3}
        <span class="note-img-more">+{note.images.length - 3}</span>
      {/if}
    </div>
  {/if}
  {#if (note.etiketler.length || (note.tags?.length ?? 0) > 0)}
    <div class="note-tags">
      {#each note.etiketler as t (t)}
        <span class="note-tag">#{t}</span>
      {/each}
      {#each (note.tags ?? []) as t (`ai-${t}`)}
        <span class="note-tag ai">#{t}</span>
      {/each}
    </div>
  {/if}
  <div class="note-time">{fmtTarih(note.guncelleme)}</div>
  <button
    class="note-coz"
    class:done={note.cozuldu}
    title={note.cozuldu ? "Reopen" : "Mark resolved"}
    onclick={(e) => { e.stopPropagation(); onCoz(note); }}
  >
    <Icon name={note.cozuldu ? "rotateCcw" : "check"} size={11} stroke={2.5} />
    <span>{note.cozuldu ? "Reopen" : "Mark resolved"}</span>
  </button>
</article>

<style>
  /* Note card style — exact clone of NotesScreen CSS. */
  .note {
    position: relative;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: 12px;
    padding: 14px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
  }
  .note:hover {
    border-color: var(--arc-primary);
    box-shadow: 0 4px 12px rgba(15, 118, 110, 0.08);
    transform: translateY(-1px);
  }
  .note.pin {
    border-color: color-mix(in srgb, var(--arc-primary) 60%, var(--arc-border));
    background: color-mix(in srgb, var(--arc-primary) 3%, var(--arc-surface));
  }
  .note.cozuldu {
    opacity: 0.6;
    background: color-mix(in srgb, var(--arc-success, #16a34a) 3%, var(--arc-surface));
  }
  .note-top {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .note-badge {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--arc-primary);
    background: color-mix(in srgb, var(--arc-primary) 10%, transparent);
    padding: 3px 8px;
    border-radius: 999px;
  }
  .note-actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
    opacity: 0;
    transition: opacity 0.13s;
  }
  .note:hover .note-actions {
    opacity: 1;
  }
  .na {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    background: transparent;
    border: 1px solid transparent;
    color: var(--arc-text-faint);
    cursor: pointer;
    transition: background 0.13s, color 0.13s, border-color 0.13s;
  }
  .na:hover {
    background: var(--arc-bg);
    color: var(--arc-text);
    border-color: var(--arc-border);
  }
  .na.on {
    color: var(--arc-primary);
  }
  .na.del:hover {
    color: var(--arc-danger);
    border-color: var(--arc-danger);
  }
  .note-baslik {
    font-size: 14.5px;
    font-weight: 600;
    color: var(--arc-text);
    line-height: 1.3;
    word-break: break-word;
  }
  .note-icerik {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--arc-text-soft);
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
  .note-imgs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .note-img-thumb {
    width: 56px;
    height: 56px;
    object-fit: cover;
    border-radius: 6px;
    border: 1px solid var(--arc-border);
  }
  .note-img-more {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--arc-text-faint);
    background: var(--arc-bg);
    border: 1px solid var(--arc-border);
    border-radius: 6px;
    padding: 2px 8px;
  }
  .note-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .note-tag {
    font-size: 10.5px;
    color: var(--arc-text-faint);
    background: var(--arc-bg);
    border: 1px solid var(--arc-border);
    padding: 1px 7px;
    border-radius: 4px;
  }
  .note-tag.ai {
    color: var(--arc-primary);
    border-color: color-mix(in srgb, var(--arc-primary) 30%, var(--arc-border));
    background: color-mix(in srgb, var(--arc-primary) 5%, var(--arc-bg));
  }
  .note-time {
    font-size: 10.5px;
    color: var(--arc-text-faint);
    font-family: var(--arc-mono, monospace);
  }
  .note-coz {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: 1px dashed var(--arc-border);
    border-radius: 999px;
    padding: 3px 10px;
    font-size: 10.5px;
    color: var(--arc-text-faint);
    cursor: pointer;
    transition: background 0.13s, color 0.13s, border-color 0.13s;
  }
  .note-coz:hover {
    background: color-mix(in srgb, var(--arc-success, #16a34a) 10%, transparent);
    color: var(--arc-success, #16a34a);
    border-color: var(--arc-success, #16a34a);
  }
  .note-coz.done {
    background: color-mix(in srgb, var(--arc-success, #16a34a) 8%, transparent);
    color: var(--arc-success, #16a34a);
    border-color: var(--arc-success, #16a34a);
    border-style: solid;
  }
</style>
