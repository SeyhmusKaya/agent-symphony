<script lang="ts">
  // rebuild_test 03:35
  // Split refactor (Mimar): moved script helpers + AgentQuestionCard +
  // ToolItem + CostLine into sub-components. This file only holds scroll
  // + message loop + chief segments rendering.
  import { tick, onMount } from "svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import EmptyState from "./EmptyState.svelte";
  import LiveActivity from "./LiveActivity.svelte";
  import Lightbox from "./Lightbox.svelte";
  import CollapsedToolGroup from "./CollapsedToolGroup.svelte";
  import AgentQuestionCard from "./chat/AgentQuestionCard.svelte";
  import ToolItem from "./chat/ToolItem.svelte";
  import SubagentInline from "./chat/SubagentInline.svelte";
  import CostLine from "./chat/CostLine.svelte";
  import { renderMarkdown } from "$lib/markdown";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import type { ChatMessage, CanliAktivite, ToolActivity } from "$lib/store.svelte";
  import type { IconName } from "$lib/icons/paths";
  import {
    PAGE,
    fmtTime,
    batchLabel,
    buildItems,
  } from "./chat/helpers.js";

  let {
    messages = [],
    running = false,
    aktivite = [],
    elapsed = 0,
    tokens = 0,
    liveIn = 0,
    liveOut = 0,
    liveCacheRead = 0,
    liveCacheCreate = 0,
    liveUncached = 0,
    liveUsd = 0,
    agentName = "Chief",
    runError = null,
    active = true,
    backgroundBusy = false,
    emptyIcon = "message" as IconName,
    emptyTitle = "Chat empty",
    emptyText = "Write your first message.",
    onCevaplaSoru,
    onInspectTool,
  }: {
    messages?: ChatMessage[];
    running?: boolean;
    aktivite?: CanliAktivite[];
    elapsed?: number;
    tokens?: number;
    liveIn?: number;
    liveOut?: number;
    liveCacheRead?: number;
    liveCacheCreate?: number;
    liveUncached?: number;
    liveUsd?: number;
    agentName?: string;
    runError?: string | null;
    active?: boolean;
    backgroundBusy?: boolean;
    emptyIcon?: IconName;
    emptyTitle?: string;
    emptyText?: string;
    onCevaplaSoru?: (cevap: string) => void;
    // Fix 93: click handler for the tool detail panel. If provided, an "inspect"
    // button appears next to the summary.
    onInspectTool?: (t: ToolActivity | CanliAktivite) => void;
  } = $props();

  // Hide a chief message ONLY if text + images + segments are all empty.
  // There used to be no segments check — if the model put all output of the
  // last turn into segments (text blocks + tool outputs) and left m.text empty,
  // the message was not rendered and the user could not see "what did you do?".
  const visible = $derived(
    messages.filter(
      (m) =>
        !(
          m.role === "sef" &&
          m.text.trim() === "" &&
          (!m.images || m.images.length === 0) &&
          (!m.segments || m.segments.length === 0)
        ),
    ),
  );

  // Lazy loading: only the last `cap` messages are rendered. Scrolling up
  // increases it by 200. If the user returns to the bottom, cap drops to PAGE (DOM stays small).
  let cap = $state(PAGE);
  const windowed = $derived(
    visible.length > cap ? visible.slice(-cap) : visible,
  );
  const hasMore = $derived(visible.length > windowed.length);

  let scrollEl: HTMLDivElement | null = $state(null);
  let userScrolledUp = $state(false);
  let lightboxSrc = $state<string | null>(null);
  let loadingOlder = false;

  async function onScroll() {
    if (!scrollEl) return;
    userScrolledUp =
      scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight > 90;
    // When back at the bottom, reset the window — keep the DOM small.
    if (!userScrolledUp && cap > PAGE) cap = PAGE;
    // Top edge — load the older 200, preserve scroll position.
    if (scrollEl.scrollTop < 60 && hasMore && !loadingOlder) {
      loadingOlder = true;
      const prevH = scrollEl.scrollHeight;
      cap += PAGE;
      await tick();
      if (scrollEl) {
        scrollEl.scrollTop = scrollEl.scrollHeight - prevH;
      }
      loadingOlder = false;
    }
  }

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    userScrolledUp = false;
  }

  // Fix 132: open external links inside chief/markdown (<a> rendered via {@html})
  // in the OS default browser instead of the app webview. Delegated listener —
  // a single listener on .thread-inner, no separate handler per <a>. closest('a')
  // finds the nearest clicked anchor. Only http(s) (external) hrefs are handled;
  // internal anchors (#hash or scheme-less) keep their default behavior.
  async function onThreadClick(e: MouseEvent) {
    const target = e.target as Element | null;
    const a = target?.closest?.("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) return; // internal anchor — leave alone
    e.preventDefault();
    try {
      await openUrl(href);
    } catch {
      // if opener fails, fail silently — the Rust on_navigation guard still
      // blocks in-webview navigation, the app does not fall onto an external page.
    }
  }

  // On open: jump straight to the bottom. The effect sometimes fires on the
  // first render before scrollEl is ready; guarantee with tick + rAF.
  onMount(async () => {
    await tick();
    requestAnimationFrame(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  // When the tab changes and the pane becomes visible, jump to the bottom ONLY
  // on the first show. Do not watch messages.length (the old code did) — every
  // new message reset userScrolledUp, which caused the bug of yanking the user
  // down while scrolling up. Scroll only on the active false→true transition.
  let prevActive = false;
  $effect(() => {
    const a = active;
    if (a && !prevActive) {
      requestAnimationFrame(() => {
        if (scrollEl) {
          scrollEl.scrollTop = scrollEl.scrollHeight;
          userScrolledUp = false;
        }
      });
    }
    prevActive = a;
  });

  // During streaming: auto-scroll to the bottom only if the user has not scrolled
  // up. If they scrolled up, PRESERVE the scroll position — it means they are
  // looking at an older message, do not force them down.
  $effect(() => {
    void visible.length;
    void running;
    void aktivite.length;
    if (scrollEl && !userScrolledUp) {
      requestAnimationFrame(() => {
        if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      });
    }
  });

  // NOT: fmtTime / fmtTok / fmtTokenShort / snip / batchLabel / toolTotalIn /
  // Item / buildItems / PAGE artik ./chat/helpers.js modulunde — bu dosyanin
  // sadece "scroll + mesaj loop + segment render" sorumlulugu kaldi.
</script>

<div class="thread-wrap">
  <div class="thread" bind:this={scrollEl} onscroll={onScroll}>
    <!-- Fix 132: delegated click — external links open in the OS browser.
         The container only listens for link delegation; it is not itself
         interactive, so suppress a11y rules (the real target is the inner <a>). -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="thread-inner" onclick={onThreadClick}>
      {#if visible.length === 0 && !running}
        <EmptyState icon={emptyIcon} title={emptyTitle} text={emptyText} />
      {:else}
        {#if hasMore}
          <button class="load-older" onclick={async () => {
            if (!scrollEl) return;
            const prevH = scrollEl.scrollHeight;
            cap += PAGE;
            await tick();
            if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight - prevH;
          }}>
            Load older messages ({visible.length - windowed.length} remaining)
          </button>
        {/if}
        {#each windowed as m, i (`${m.ts}-${i}`)}
          {@const isUser = m.role === "kullanici"}
          {@const isOtonom = m.role === "otonom"}
          {@const isAgentQ = m.role === "agent_question"}
          {@const isUserChoice = m.role === "user_choice"}
          {@const isAgentCmd = m.role === "ajan_komut"}
          {@const streaming = running && m.role === "sef" && i === windowed.length - 1}
          {#if isAgentQ}
            <AgentQuestionCard msg={m} onCevap={onCevaplaSoru} />
          {:else if isUserChoice}
            <div class="turn user user-choice">
              <div class="bubble-user choice">
                <div class="choice-tag">
                  <Icon name="check" size={10} stroke={2.6} />
                  <span>Selected</span>
                </div>
                <div class="user-text">{m.text}</div>
              </div>
              <span class="turn-time">{fmtTime(m.ts)}</span>
            </div>
          {:else if isAgentCmd}
            <div class="turn agent-cmd">
              <div class="agent-cmd-bar">
                <Icon name="message" size={12} stroke={2.2} />
                <span class="agent-cmd-tag">From agent</span>
                <span class="agent-cmd-from">{m.fromAgent || "another agent"}</span>
                <span class="turn-time">{fmtTime(m.ts)}</span>
              </div>
              <!-- Fix 137: cross-agent message now renders markdown (the old <pre>
                   monospace was unreadable). Same fluid display as the user. -->
              <div class="agent-cmd-text md">{@html renderMarkdown(m.text)}</div>
            </div>
          {:else if isOtonom}
            <div class="turn otonom">
              <div class="otonom-bar">
                <Icon name="cpu" size={12} stroke={2.2} />
                <span>AUTONOMOUS TURN</span>
                <span class="turn-time">{fmtTime(m.ts)}</span>
              </div>
              <div class="otonom-text md">{@html renderMarkdown(m.text)}</div>
            </div>
          {:else if isUser}
            <div class="turn user">
              <div class="bubble-user" class:queued={m.queued}>
                {#if m.queued}
                  <div class="queued-tag">
                    <span class="queued-dot"></span>
                    <span>Queued</span>
                  </div>
                {/if}
                {#if m.images && m.images.length}
                  <div class="imgs" class:single={m.images.length === 1}>
                    {#each m.images as src, ii (ii)}
                      <button class="img-btn" onclick={() => (lightboxSrc = src)}>
                        <img {src} alt="Attached image" />
                      </button>
                    {/each}
                  </div>
                {/if}
                {#if m.text.trim()}
                  <div class="user-text">{m.text}</div>
                {/if}
              </div>
              <span class="turn-time">{fmtTime(m.ts)}</span>
            </div>
          {:else}
            <div class="turn assist">
              <div class="assist-head">
                <span class="assist-name">{agentName}</span>
                <span class="turn-time">{fmtTime(m.ts)}</span>
              </div>
              {#if m.images && m.images.length}
                <div class="imgs" class:single={m.images.length === 1}>
                  {#each m.images as src, ii (ii)}
                    <button class="img-btn" onclick={() => (lightboxSrc = src)}>
                      <img {src} alt="Image" />
                    </button>
                  {/each}
                </div>
              {/if}
              {#if m.segments && m.segments.length}
                {@const items = buildItems(m.segments)}
                {@const lastTextIdx = items.reduce((acc, it, idx) => it.kind === "text" ? idx : acc, -1)}
                {#each items as it, ii (`it-${ii}`)}
                  {#if it.kind === "text"}
                    <div class="md">
                      {@html renderMarkdown(it.text)}
                    </div>
                  {:else if it.kind === "tool"}
                    {#if it.tool.ad === "Agent"}
                      <!-- F1.4: SDK native Agent tool call — enriched card if a
                           specialist was spawned. SubagentInline instead of
                           plain ToolItem. -->
                      <SubagentInline tool={it.tool} onInspect={onInspectTool} live={streaming} />
                    {:else}
                      <ToolItem tool={it.tool} onInspect={onInspectTool} extraClass="inline-tool" />
                    {/if}
                  {:else}
                    <!-- NOTE: groups of 3+ consecutive same-named tools are rendered
                         with CollapsedToolGroup. Since the Agent tool is rarely
                         consecutively repeated, the SubagentInline dispatch is skipped
                         in the group branch — keep it simple (ToolItem already shows Agent by name). -->
                    <CollapsedToolGroup tools={it.tools} />
                  {/if}
                {/each}
                {#if lastTextIdx === -1 && m.text && m.text.trim()}
                  <div class="md">
                    {@html renderMarkdown(m.text)}
                  </div>
                {/if}
              {:else}
                {#if m.aktivite && m.aktivite.length}
                  <details class="tool-batch">
                    <summary>
                      <Icon name="terminal" size={11} stroke={2} />
                      <span class="batch-label">{batchLabel(m.aktivite)}</span>
                      <Icon name="chevronDown" size={12} class="batch-chev" />
                    </summary>
                    <div class="tool-batch-list">
                      {#each m.aktivite as a, ti (a.ad + ti)}
                        <ToolItem tool={a} onInspect={onInspectTool} />
                      {/each}
                    </div>
                  </details>
                {/if}
                <div class="md">
                  {@html renderMarkdown(m.text)}
                </div>
              {/if}
              <!-- M11: narrative summary removed — the reply already stated the
                   same intent in its first sentence, repeating it as gray text wasted space. -->
              {#if false && m.narrative}
                <div class="narrative" title="This turn's 60-char summary intent">
                  {m.narrative}
                </div>
              {/if}
              {#if m.autonomousFail}
                <div class="autofail">
                  <Icon name="x" size={10} stroke={2.6} />
                  <span>Turn failed (error_during_execution)</span>
                </div>
              {/if}
              <!-- Fix 121: the turn was cut before completing (rebuild/restart).
                   Partial content was written to disk — it shows on reload; this
                   badge shows the user where it left off.
                   Fix 125: added !m._live. While the turn was STILL streaming, if
                   the user sent a new message the live draft stopped being the end
                   of the list → `streaming` became false → the streaming turn was
                   wrongly marked "Incomplete". The _live flag is independent of list
                   position; the badge only shows on truly sealed/cut turns
                   (sealLiveDraftsOnBoot clears _live, leaving incomplete). -->
              {#if m.incomplete && !m._live && !streaming}
                <div class="incomplete">
                  <Icon name="loader" size={10} stroke={2.4} />
                  <span>Incomplete — cut off</span>
                </div>
              {/if}
              {#if m.role !== "kullanici" && (m.ts || (m.cost && (m.cost.in > 0 || m.cost.out > 0)))}
                {@const prevSefMsg = (() => {
                  for (let k = i - 1; k >= 0; k--) {
                    const pm = windowed[k];
                    if (pm && pm.role !== "kullanici" && pm.ts && pm.cost && (pm.cost.in > 0 || pm.cost.out > 0)) return pm;
                  }
                  return null;
                })()}
                <CostLine msg={m} {prevSefMsg} />
              {/if}
            </div>
          {/if}
        {/each}
      {/if}

      {#if running && !backgroundBusy}
        <div class="turn assist live-turn">
          <LiveActivity
            {aktivite}
            {elapsed}
            {tokens}
            {liveIn}
            {liveOut}
            {liveCacheRead}
            {liveCacheCreate}
            {liveUncached}
            {liveUsd}
            label={agentName}
            error={runError}
          />
        </div>
      {:else if running && backgroundBusy}
        <div class="bg-busy">
          <Icon name="loader" size={11} stroke={2.2} spin={true} />
          <span>Background work — autonomous turn running</span>
        </div>
      {/if}
    </div>
  </div>

  {#if userScrolledUp}
    <button class="jump" onclick={scrollToBottom} title="Scroll to bottom" aria-label="Scroll to bottom">
      <Icon name="arrowDown" size={15} stroke={2.2} />
    </button>
  {/if}
</div>

<Lightbox src={lightboxSrc} onClose={() => (lightboxSrc = null)} />

<style>
  .thread-wrap {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
  }
  .thread {
    flex: 1;
    overflow-y: auto;
    background: var(--arc-chat-bg);
  }
  .thread-inner {
    max-width: 1200px;
    margin: 0 auto;
    padding: 26px 20px 32px;
    display: flex;
    flex-direction: column;
    gap: 22px;
    min-height: 100%;
    box-sizing: border-box;
  }

  .turn {
    display: flex;
    flex-direction: column;
    animation: turn-in 0.2s var(--arc-ease);
  }
  @keyframes turn-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  /* ---- Autonomous turn (background task result) ---- */
  .turn.otonom {
    align-items: stretch;
    gap: 0;
    border: 1px dashed var(--arc-primary, #0F766E);
    border-radius: 10px;
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 5%, transparent);
    padding: 8px 12px;
  }
  .otonom-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--arc-primary-strong, #0F766E);
    text-transform: uppercase;
    margin-bottom: 4px;
  }
  .otonom-bar .turn-time {
    margin-left: auto;
    font-weight: 500;
    color: var(--arc-text-faint);
  }
  .otonom-text {
    font-size: 12.5px;
    line-height: 1.55;
    word-break: break-word;
    color: var(--arc-text-soft);
    margin: 0;
  }
  /* ---- Cross-agent komut (talk_to_chief) ---- */
  .turn.agent-cmd {
    align-items: stretch;
    gap: 0;
    border: 1px solid color-mix(in srgb, var(--arc-primary, #0F766E) 40%, var(--arc-border));
    border-left: 3px solid var(--arc-primary, #0F766E);
    border-radius: 10px;
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 6%, transparent);
    padding: 8px 12px;
  }
  .agent-cmd-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--arc-primary);
    text-transform: uppercase;
    margin-bottom: 5px;
  }
  .agent-cmd-from {
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
    color: var(--arc-text-soft);
    background: color-mix(in srgb, var(--arc-primary) 15%, transparent);
    padding: 2px 7px;
    border-radius: 9px;
    font-size: 10.5px;
  }
  .agent-cmd-bar .turn-time {
    margin-left: auto;
    font-weight: 500;
    color: var(--arc-text-faint);
    text-transform: none;
  }
  .agent-cmd-text {
    font-size: 13px;
    line-height: 1.55;
    word-break: break-word;
    color: var(--arc-text);
    margin: 0;
  }

  /* NOTE: .turn.assist.agent-q + its sub-classes were moved into
     chat/AgentQuestionCard.svelte. CSS scoped — the sub-component holds its own styles. */

  /* ---- User choice (user_choice) ---- */
  .bubble-user.choice {
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 6%, #ffffff);
    border-color: var(--arc-primary);
  }
  .choice-tag {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--arc-primary-strong);
    margin-bottom: 2px;
  }

  /* ---- User ---- */
  .turn.user {
    align-items: flex-end;
    gap: 4px;
  }
  .bubble-user {
    max-width: 86%;
    background: #ffffff;
    border: 1px solid var(--arc-border);
    border-radius: 16px 16px 4px 16px;
    padding: 14px 20px;
    display: flex;
    flex-direction: column;
    gap: 9px;
    transition:
      background 0.18s var(--arc-ease),
      border-color 0.18s var(--arc-ease);
  }
  .bubble-user.queued {
    background: #ecfdf5; /* light green (mint-50) */
    border-color: #a7f3d0;
    box-shadow: 0 0 0 3px rgba(167, 243, 208, 0.25);
  }
  .queued-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #047857;
    background: #d1fae5;
    border: 1px solid #6ee7b7;
    border-radius: 999px;
    padding: 3px 9px 3px 7px;
    align-self: flex-start;
    margin-bottom: 2px;
  }
  .queued-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #10b981;
    box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45);
    animation: q-pulse 1.4s var(--arc-ease) infinite;
  }
  @keyframes q-pulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.45);
    }
    50% {
      box-shadow: 0 0 0 5px rgba(16, 185, 129, 0);
    }
  }
  .user-text {
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--arc-text);
  }
  .turn-time {
    font-size: 10px;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
    padding: 0 4px;
  }

  /* ---- Agent ---- */
  .turn.assist {
    align-items: stretch;
    gap: 7px;
  }
  .assist-head {
    display: flex;
    align-items: baseline;
    gap: 9px;
  }
  .assist-name {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--arc-primary);
  }
  /* NOTE: the .ts-cost-line + .tsc-* classes were moved into chat/CostLine.svelte. */
  .narrative {
    align-self: flex-start;
    font-size: 11.5px;
    font-style: italic;
    color: var(--arc-text-faint);
    margin-top: 4px;
    padding-left: 2px;
    letter-spacing: 0.01em;
  }
  .autofail {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 4px;
    padding: 3px 9px;
    border-radius: var(--arc-r-pill);
    background: color-mix(in srgb, var(--arc-danger) 12%, transparent);
    color: var(--arc-danger);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  /* Fix 121: incomplete-turn badge — not danger but a "warning/interruption" tone. */
  .incomplete {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 4px;
    padding: 3px 9px;
    border-radius: var(--arc-r-pill);
    background: color-mix(in srgb, var(--arc-warning, #b45309) 12%, transparent);
    color: var(--arc-warning, #b45309);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .live-turn {
    margin-top: -8px;
  }
  .bg-busy {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    margin-top: 4px;
    padding: 6px 12px;
    border: 1px dashed var(--arc-border);
    border-radius: var(--arc-r-pill);
    background: color-mix(in srgb, var(--arc-primary, #0F766E) 4%, transparent);
    color: var(--arc-text-faint);
    font-size: 11px;
    font-style: italic;
  }
  .bg-busy :global(svg) {
    color: var(--arc-primary);
  }

  /* ---- Images ---- */
  .imgs {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }
  .imgs.single {
    grid-template-columns: 1fr;
    max-width: 320px;
  }
  .img-btn {
    padding: 0;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    overflow: hidden;
    background: var(--arc-surface);
    cursor: zoom-in;
    line-height: 0;
    transition: transform 0.15s var(--arc-ease), box-shadow 0.15s var(--arc-ease);
  }
  .img-btn:hover {
    transform: translateY(-2px);
    box-shadow: var(--arc-shadow);
  }
  .img-btn img {
    width: 100%;
    max-height: 240px;
    object-fit: cover;
    display: block;
  }

  /* ---- Load older ---- */
  .load-older {
    align-self: center;
    margin-bottom: 6px;
    padding: 7px 14px;
    border-radius: var(--arc-r-pill);
    border: 1px solid var(--arc-border);
    background: var(--arc-surface);
    color: var(--arc-text-soft);
    font-size: 12px;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .load-older:hover {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
    border-color: var(--arc-primary);
  }

  /* ---- Jump ---- */
  .jump {
    position: absolute;
    bottom: 16px;
    left: 50%;
    transform: translateX(-50%);
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: var(--arc-r-pill);
    border: 1px solid var(--arc-border);
    background: var(--arc-surface);
    color: var(--arc-primary);
    box-shadow: var(--arc-shadow);
    transition: transform 0.15s var(--arc-ease);
  }
  .jump:hover {
    transform: translateX(-50%) translateY(-2px);
  }

  /* ---- Markdown ---- */
  .md {
    font-size: 14px;
    line-height: 1.68;
    word-break: break-word;
    color: var(--arc-text);
  }
  .md :global(> *:first-child) {
    margin-top: 0;
  }
  .md :global(> *:last-child) {
    margin-bottom: 0;
  }
  .md :global(h1),
  .md :global(h2),
  .md :global(h3) {
    font-size: 15px;
    font-weight: 600;
    margin: 18px 0 8px;
    color: var(--arc-text);
  }
  .md :global(p) {
    margin: 10px 0;
  }
  .md :global(ul),
  .md :global(ol) {
    margin: 10px 0;
    padding-left: 22px;
  }
  .md :global(li) {
    margin: 4px 0;
  }
  .md :global(code) {
    font-family: var(--arc-mono);
    background: var(--arc-n100);
    border: 1px solid var(--arc-border);
    border-radius: 5px;
    padding: 1px 5px;
    font-size: 12.5px;
  }
  .md :global(pre) {
    background: var(--arc-n900);
    border-radius: var(--arc-r-sm);
    padding: 14px 15px;
    overflow-x: auto;
    margin: 12px 0;
  }
  .md :global(pre code) {
    border: none;
    padding: 0;
    background: none;
    color: #e5e8ec;
    font-size: 12.5px;
    line-height: 1.6;
  }
  /* ---- Code block copy button (Claude Code style) ---- */
  .md :global(.code-block) {
    position: relative;
  }
  .md :global(.code-copy) {
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
  .md :global(.code-block:hover .code-copy),
  .md :global(.code-copy:focus-visible) {
    opacity: 1;
  }
  .md :global(.code-copy:hover) {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.28);
  }
  .md :global(.code-copy)::before {
    content: "";
    width: 14px;
    height: 14px;
    background-color: #cbd5e1;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='9' y='9' width='13' height='13' rx='2'/%3E%3Cpath d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Crect x='9' y='9' width='13' height='13' rx='2'/%3E%3Cpath d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'/%3E%3C/svg%3E") center / contain no-repeat;
  }
  .md :global(.code-copy.copied) {
    opacity: 1;
    background: rgba(52, 211, 153, 0.16);
    border-color: rgba(52, 211, 153, 0.5);
  }
  .md :global(.code-copy.copied)::before {
    background-color: #34d399;
    -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='20 6 9 17 4 12'/%3E%3C/svg%3E") center / contain no-repeat;
  }
  .md :global(table) {
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 13px;
    width: 100%;
  }
  .md :global(th),
  .md :global(td) {
    border: 1px solid var(--arc-border);
    padding: 6px 10px;
    text-align: left;
  }
  .md :global(th) {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
    font-weight: 600;
  }
  .md :global(a) {
    color: var(--arc-primary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .md :global(blockquote) {
    border-left: 3px solid var(--arc-primary-soft);
    margin: 12px 0;
    padding: 2px 0 2px 14px;
    color: var(--arc-text-soft);
  }
  .md :global(hr) {
    border: none;
    border-top: 1px solid var(--arc-border);
    margin: 18px 0;
  }

  /* ---- Tool batch (inline) ---- */
  .tool-batch {
    margin-top: 2px;
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    background: #ffffff;
    font-size: 11.5px;
    overflow: hidden;
    align-self: flex-start;
    max-width: 100%;
  }
  .tool-batch > summary {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    padding: 6px 10px;
    font-weight: 500;
    color: var(--arc-text-soft);
    user-select: none;
    list-style: none;
  }
  .tool-batch > summary::-webkit-details-marker {
    display: none;
  }
  .tool-batch > summary :global(.batch-chev) {
    margin-left: 4px;
    transition: transform 0.15s var(--arc-ease);
    color: var(--arc-text-faint);
  }
  .tool-batch[open] > summary :global(.batch-chev) {
    transform: rotate(180deg);
  }
  .batch-label {
    font-family: var(--arc-mono);
    color: var(--arc-primary-strong);
  }
  .tool-batch-list {
    border-top: 1px solid var(--arc-border);
  }
  /* NOTE: the .tool / .tool.inline-tool / .tool-sum / .tool-name / .tool-snip /
     .tool-detay / .tool-io / .tool-k / .tool-tok / .tool-inspect / .tool-cost
     classes were moved into chat/ToolItem.svelte (scoped). */
</style>
