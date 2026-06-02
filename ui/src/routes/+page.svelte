<script lang="ts">
  import { onMount } from "svelte";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { confirmDialog } from "$lib/ui/confirm";
  import Usage from "$lib/Usage.svelte";
  import ReportsScreen from "$lib/ReportsScreen.svelte";
  import ServersScreen from "$lib/ServersScreen.svelte";
  import CodeGraphScreen from "$lib/CodeGraphScreen.svelte";
  import ToolsScreen from "$lib/ToolsScreen.svelte";
  import ProjectScreen from "$lib/ProjectScreen.svelte";
  import GlobalChief from "$lib/GlobalChief.svelte";
  import NotesScreen from "$lib/NotesScreen.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import Avatar from "$lib/ui/Avatar.svelte";
  import Badge from "$lib/ui/Badge.svelte";
  import Button from "$lib/ui/Button.svelte";
  import NavRail from "$lib/router/NavRail.svelte";
  import TabBar from "$lib/router/TabBar.svelte";
  import { EFFORTS, AGENTS, modelShort, relativeTime } from "$lib/router/helpers.js";
  import { agentIcon } from "$lib/ui/agentVisual";
  import { ProjectSession } from "$lib/store.svelte";
  import { notifyAgentIdle, onAgentNotificationClick, takePendingAgentNav } from "$lib/notify";
  import {
    listProjects,
    pickProjectFolder,
    touchProject,
    removeProject,
    startProject,
    addProject,
    startupProjectPath,
    renameProject,
    refreshAllLogos,
    setProjectReportEnabled,
    type Project,
  } from "$lib/api";

  interface Tab {
    id: string;
    name: string;
    port: number;
  }

  let projects = $state<Project[]>([]);
  let loading = $state(true);
  let busy = $state(false);
  let view = $state<string>("mimar");
  let advisorsOpen = $state(false);
  let agentModelMenu = $state<string | null>(null);
  // Fix 96: Rail collapse/expand — when the user toggles, 56px icon-only <-> 200px label mode.
  // Default collapsed (UX spec); state in localStorage `nav_rail_expanded`. Ctrl+\ shortcut.
  let railExpanded = $state(false);
  let railLoaded = $state(false); // guard against writing before localStorage is read
  function toggleRail() {
    railExpanded = !railExpanded;
  }
  function onRailKey(e: KeyboardEvent) {
    // Ctrl+\ (VSCode convention; Ctrl+B can clash with Svelte HMR).
    if ((e.ctrlKey || e.metaKey) && e.key === "\\") {
      e.preventDefault();
      toggleRail();
    }
  }
  $effect(() => {
    if (!railLoaded) return; // do not override before mount
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("nav_rail_expanded", String(railExpanded));
      }
    } catch { /* skip */ }
  });
  // NOTE: MODELS / EFFORTS / AGENTS / modelShort / relativeTime are pure constants
  // imported from ./router/helpers.ts (shared by NavRail + TabBar).
  let tabs = $state<Tab[]>([]);
  let activeTab = $state<string>("launcher");
  // per-tab activity: "busy" = running, "unread" = finished but not seen, null = normal
  let tabActivity = $state<Map<string, "busy" | "unread">>(new Map());

  // Projects tab dot state
  const launcherDot = $derived.by(() => {
    if (!sessions.mimar?.connected) return "error";
    const vals = [...tabActivity.values()];
    if (vals.includes("busy")) return "busy";
    if (vals.includes("unread")) return "unread";
    return null;
  });

  const sessions: Record<string, ProjectSession> = {};
  for (const a of AGENTS) {
    const s = new ProjectSession();
    s.agentDisplayName = a.name;
    sessions[a.key] = s;
  }

  let unseen = $state<Record<string, boolean>>({});
  const prevIdleSignal: Record<string, number> = {};

  // Window/tab focus state — notify when an agent finishes, but do not disturb
  // the user if they are already looking at that tab. Inter-agent communication
  // does not trigger sef_cevap (specialist runSpecialist is inside the SDK), so
  // this only fires for user-facing agent chats.
  function isAgentVisible(agentKey: string): boolean {
    if (typeof document === "undefined") return true;
    if (document.visibilityState !== "visible") return false;
    if (!document.hasFocus()) return false;
    return view === agentKey;
  }

  // The notification fires ONLY on the sef_tamamen_idle event — the backend
  // sends the signal only AFTER making SURE the queue is truly empty + the
  // autonomous chain has ended + no bgTask is pending. This prevents false
  // notifications (post-update, devam_gorevi, autonomous turns do not trigger
  // notifications). All channels go through lib/notify.ts; title "Agent Symphony".
  $effect(() => {
    for (const a of AGENTS) {
      const sess = sessions[a.key];
      const sig = sess.tamamenIdleSignal;
      const prev = prevIdleSignal[a.key] ?? 0;
      if (sig > prev) {
        prevIdleSignal[a.key] = sig;
        if (!isAgentVisible(a.key)) {
          unseen = { ...unseen, [a.key]: true };
          const lastMsg = sess.chat[sess.chat.length - 1];
          const body = lastMsg && lastMsg.role === "sef" ? lastMsg.text : "Task completed.";
          void notifyAgentIdle({
            agentName: a.name,
            agentKey: a.key,
            lastMessage: body,
            elapsedMs: sess.runElapsed,
            liveIn: sess.liveIn,
            liveOut: sess.liveOut,
            forceShow: true, // this tab/agent is not visible, an OS notification is required
          });
        }
      } else if (sig < prev) {
        // Reconnect / counter reset — update the reference.
        prevIdleSignal[a.key] = sig;
      }
    }
  });

  const railSel = $derived(
    view === "notlar"
      ? "notlar"
      : view === "kullanim"
        ? "kullanim"
        : view === "raporlar"
          ? "raporlar"
          : view === "sunucular"
            ? "sunucular"
            : view === "araclar"
              ? "araclar"
              : view === "codegraph"
                ? "codegraph"
                : "sohbet",
  );

  const mimar = AGENTS[0];
  const advisors = AGENTS.slice(1);

  function openAgent(key: string) {
    view = key;
    if (unseen[key]) unseen = { ...unseen, [key]: false };
  }

  // Called when a notification is clicked. If the key is an AGENT (mimar/advisor),
  // go back to the main launcher + open that agent view. If it is a project chief
  // id, select the matching tab if it exists; otherwise ignore silently (the project tab may have closed).
  function navigateToAgent(key: string) {
    const ag = AGENTS.find((a) => a.key === key);
    if (ag) {
      selectTab("launcher");
      openAgent(key);
      return;
    }
    const tab = tabs.find((t) => t.id === key);
    if (tab) selectTab(key);
  }

  function selectRail(mode: string) {
    selectTab("launcher");
    if (mode === "notlar") view = "notlar";
    else if (mode === "kullanim") view = "kullanim";
    else if (mode === "raporlar") view = "raporlar";
    else if (mode === "sunucular") view = "sunucular";
    else if (mode === "araclar") view = "araclar";
    else if (mode === "codegraph") view = "codegraph";
    else if (view === "notlar" || view === "kullanim" || view === "raporlar" || view === "sunucular" || view === "araclar" || view === "codegraph") view = "mimar";
  }

  async function refresh() {
    projects = await listProjects();
  }

  function setWindowTitle(t: string) {
    try {
      void getCurrentWindow().setTitle(t);
    } catch {
      /* browser */
    }
  }

  function selectTab(id: string) {
    activeTab = id;
    const tab = tabs.find((t) => t.id === id);
    setWindowTitle(tab ? `Agent Symphony — ${tab.name}` : "Agent Symphony");
    // clicking a tab clears unread (leave busy as is)
    if (tabActivity.get(id) === "unread") {
      const m = new Map(tabActivity); m.delete(id); tabActivity = m;
    }
  }

  let openingProjectId = $state<string | null>(null);
  const openingProject = $derived(openingProjectId ? projects.find((p) => p.id === openingProjectId) ?? null : null);

  async function openProject(p: Project) {
    await touchProject(p.id);
    const existing = tabs.find((t) => t.id === p.id);
    if (existing) {
      selectTab(p.id);
      return;
    }
    openingProjectId = p.id;
    try {
      const port = await startProject(p.id);
      tabs = [...tabs, { id: p.id, name: p.name, port }];
      selectTab(p.id);
      await refresh();
    } finally {
      openingProjectId = null;
    }
  }

  function closeTab(id: string) {
    tabs = tabs.filter((t) => t.id !== id);
    if (activeTab === id) selectTab("launcher");
  }

  // Chrome-style tab dragging is done with pointer events inside TabBar.
  // When the drag ends the new order (id array) comes here; tabs is sorted by it.
  // Projects (launcher) is not in this list — it always stays fixed.
  function reorderTabs(ids: string[]) {
    const map = new Map(tabs.map((t) => [t.id, t]));
    const next = ids.map((id) => map.get(id)).filter((t): t is Tab => !!t);
    if (next.length === tabs.length) tabs = next;
  }

  async function newProject() {
    busy = true;
    try {
      const created = await pickProjectFolder();
      if (created) {
        await refresh();
        await openProject(created);
      }
    } finally {
      busy = false;
    }
  }

  let refreshingLogos = $state(false);
  let renameTarget = $state<Project | null>(null);
  let renameDraft = $state("");

  async function refreshLogos() {
    if (refreshingLogos) return;
    refreshingLogos = true;
    try {
      projects = await refreshAllLogos();
    } finally {
      refreshingLogos = false;
    }
  }

  function startRename(e: MouseEvent, p: Project) {
    e.stopPropagation();
    renameTarget = p;
    renameDraft = p.name;
  }

  async function applyRename() {
    if (!renameTarget) return;
    const t = renameTarget;
    const name = renameDraft.trim();
    if (!name || name === t.name) {
      renameTarget = null;
      return;
    }
    try {
      await renameProject(t.id, name);
      await refresh();
    } finally {
      renameTarget = null;
    }
  }

  async function deleteProject(e: MouseEvent, p: Project) {
    e.stopPropagation();
    const ok = await confirmDialog(
      `"${p.name}" will be removed from the list and its session data deleted.\nAre you sure?`,
      { title: "Delete project", danger: true, okLabel: "Delete" },
    );
    if (!ok) return;
    await removeProject(p.id);
    await refresh();
  }

  async function toggleReportEnabled(e: MouseEvent, p: Project) {
    e.stopPropagation();
    const next = !p.reportEnabled;
    await setProjectReportEnabled(p.id, next);
    await refresh();
  }

  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "N" || e.key === "n")) {
        e.preventDefault();
        selectTab("launcher");
        view = "notlar";
        return;
      }
      // Fix 97: Chrome tab shortcuts
      // Ctrl+Tab: next tab (cycle)
      // Ctrl+Shift+Tab: previous tab (cycle)
      // Ctrl+1...Ctrl+8: tab at index (1=launcher, 2-8=tabs[0..6])
      // Ctrl+9: last tab
      // Ctrl+W: close active tab (launcher does not close)
      // Ctrl+T: new project (folder picker)
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // Ctrl+Tab / Ctrl+Shift+Tab — order: launcher (0), then tabs in sequence
      if (e.key === "Tab") {
        e.preventDefault();
        const order: string[] = ["launcher", ...tabs.map((t) => t.id)];
        const cur = order.indexOf(activeTab);
        if (cur < 0) return;
        const next = e.shiftKey
          ? (cur - 1 + order.length) % order.length
          : (cur + 1) % order.length;
        selectTab(order[next]);
        return;
      }
      // Ctrl+W — close the active tab (except launcher)
      if ((e.key === "w" || e.key === "W") && !e.shiftKey) {
        if (activeTab !== "launcher") {
          e.preventDefault();
          closeTab(activeTab);
        }
        return;
      }
      // Ctrl+T — new project (folder picker, if not busy)
      if ((e.key === "t" || e.key === "T") && !e.shiftKey) {
        e.preventDefault();
        if (!busy) void newProject();
        return;
      }
      // Ctrl+1...Ctrl+8 — indexed tab
      // Ctrl+9 — last tab
      if (e.key >= "1" && e.key <= "9" && !e.shiftKey) {
        const order: string[] = ["launcher", ...tabs.map((t) => t.id)];
        const n = Number(e.key);
        let target: string | null = null;
        if (n === 9) {
          target = order[order.length - 1] ?? null;
        } else if (n - 1 < order.length) {
          target = order[n - 1];
        }
        if (target) {
          e.preventDefault();
          selectTab(target);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  onMount(() => {
    for (const a of AGENTS) sessions[a.key].connect(a.port);
  });

  // Notification click routing.
  // Two paths at once:
  //   1) plugin onAction listener (if tauri-plugin-notification supports it,
  //      a Windows toast click calls back with extra.agentKey).
  //   2) Fallback: when a notification opens, pendingNavAgent is set; when the
  //      window regains focus, if there is a pending one it is used. A toast click
  //      does not always trigger onAction on Windows — focus fallback safety.
  onMount(() => {
    const off = onAgentNotificationClick((key) => navigateToAgent(key));
    function onFocus() {
      const k = takePendingAgentNav();
      if (k) navigateToAgent(k);
    }
    window.addEventListener("focus", onFocus);
    return () => {
      off();
      window.removeEventListener("focus", onFocus);
    };
  });

  onMount(async () => {
    // Load the rail expand state from localStorage (Fix 96)
    try {
      if (typeof localStorage !== "undefined") {
        railExpanded = localStorage.getItem("nav_rail_expanded") === "true";
      }
    } catch { /* skip */ }
    railLoaded = true;
    try {
      const shortcutPath = await startupProjectPath();
      if (shortcutPath) {
        const name = shortcutPath.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "Project";
        const created = await addProject(name, shortcutPath);
        await refresh();
        await openProject(created);
      } else {
        await refresh();
      }
      // Warm-up: start chief servers for all projects in the background.
      // start_project (ensure_orchestrator) is idempotent — returns the port if
      // it exists, otherwise opens one. An idle process spends no tokens. So when
      // a project is clicked the WS is immediately Connected and the "Disconnected"
      // delay disappears. The session is preserved (chief.json + .team/sessions).
      for (const p of projects) {
        startProject(p.id).catch((err) => {
          console.warn(`[warm] ${p.name}: ${err}`);
        });
      }
    } finally {
      loading = false;
    }
  });
</script>

<svelte:window onkeydown={onRailKey} />

<div class="shell">
  <!-- GLOBAL RAIL -->
  <NavRail
    {railExpanded}
    {activeTab}
    {railSel}
    onToggle={toggleRail}
    onSelect={selectRail}
  />

  <div class="stack">
    <!-- TAB STRIP — Chrome style (Fix 97) -->
    <TabBar
      {tabs}
      {activeTab}
      {launcherDot}
      {tabActivity}
      {busy}
      {openingProjectId}
      openingProjectName={openingProject?.name ?? "…"}
      onSelectTab={selectTab}
      onCloseTab={closeTab}
      onReorder={reorderTabs}
      onNewProject={newProject}
    />

    <div class="shell-body">
      <!-- PROJECT OPENING — overlay -->
      {#if openingProjectId && !tabs.find((t) => t.id === openingProjectId)}
        <div class="pane lp-pane">
          <div class="lp-center">
            <div class="lp-avatar">
              <Avatar
                label={openingProject?.name ?? "…"}
                image={openingProject?.logoUri}
                size={64}
                variant="outline"
              />
              <div class="lp-avatar-ring"></div>
            </div>
            <div class="lp-title">{openingProject?.name ?? "Project"}</div>
            <div class="lp-sub">Preparing the environment…</div>
            <div class="lp-bar">
              <div class="lp-bar-fill"></div>
            </div>
          </div>
        </div>
      {/if}

      <!-- LAUNCHER -->
      <div class="pane" style:display={activeTab === "launcher" ? "block" : "none"}>
        <div style:display={view === "notlar" ? "block" : "none"} style="height:100%">
          <NotesScreen />
        </div>
        {#if view === "kullanim"}
          <div class="screen">
            <header class="screen-head">
              <div>
                <span class="arc-caption">Monitoring</span>
                <div class="screen-title">Usage statistics</div>
              </div>
            </header>
            <div class="screen-body"><Usage provider={sessions[mimar.key].provider} /></div>
          </div>
        {:else if view === "raporlar"}
          <ReportsScreen
            {projects}
            onApprove={(text, proj) => {
              if (proj) {
                // If a project is selected: open the project first, then send to the chief
                const existingTab = tabs.find((t) => t.id === proj.id);
                if (existingTab) {
                  selectTab(proj.id);
                } else {
                  void openProject(proj);
                }
              }
              sessions.mimar.sendCommand(text);
              if (!proj) {
                view = "mimar";
                selectTab("launcher");
              }
            }}
          />
        {:else if view === "sunucular"}
          <ServersScreen />
        {:else if view === "araclar"}
          <ToolsScreen />
        {:else if view === "codegraph"}
          <CodeGraphScreen session={sessions.mimar} {tabs} />
        {:else if view !== "notlar"}
          <div class="split">
            <aside class="sidebar">
              <div class="sb-brand">
                <div class="sb-brand-name">Architect</div>
                <div class="sb-brand-sub">Multi-agent orchestration</div>
              </div>

              <div class="sb-group">
                <span class="arc-caption">Main chief</span>
              </div>
              <button
                class="agent"
                class:on={view === mimar.key}
                onclick={() => openAgent(mimar.key)}
              >
                <Avatar
                  label={mimar.name}
                  icon={agentIcon(mimar.name, mimar.subtitle)}
                  image="/logo-square.png"
                  size={34}
                  variant="gradient"
                />
                <div class="agent-id">
                  <div class="agent-name">{mimar.name}</div>
                  <div class="agent-sub">{mimar.subtitle}</div>
                </div>
                {#if sessions[mimar.key].running}
                  <Badge variant="soft" tone="warn" dot pulse>In progress</Badge>
                {:else if unseen[mimar.key]}
                  <Badge variant="soft" tone="ok" dot pulse>Ready</Badge>
                {/if}
                <div
                  class="ag-mw"
                  role="none"
                  onclick={(e) => { e.stopPropagation(); agentModelMenu = agentModelMenu === mimar.key ? null : mimar.key; }}
                >
                  <span class="ag-mc">{modelShort(sessions[mimar.key].chiefModel)}</span>
                  <span class="ag-dot">·</span>
                  <span class="ag-ec">{sessions[mimar.key].chiefEffort}</span>
                  {#if agentModelMenu === mimar.key}
                    <div
                      class="ag-mm-backdrop"
                      role="button"
                      tabindex="-1"
                      aria-label="Close"
                      onclick={(e) => { e.stopPropagation(); agentModelMenu = null; }}
                      onkeydown={(e) => e.key === "Escape" && (agentModelMenu = null)}
                    ></div>
                    <div class="ag-mm arc-card" role="none" onclick={(e) => e.stopPropagation()}>
                      <span class="arc-caption">Model</span>
                      {#each sessions[mimar.key].availableModels as m (m)}
                        <button
                          class="ag-mo"
                          class:sel={sessions[mimar.key].chiefModel === m}
                          onclick={(e) => { e.stopPropagation(); sessions[mimar.key].setChiefModel(m, sessions[mimar.key].chiefEffort); agentModelMenu = null; }}
                        >{modelShort(m)}</button>
                      {/each}
                      <span class="arc-caption" style="margin-top:4px">Effort</span>
                      <div class="ag-er">
                        {#each EFFORTS as ef (ef)}
                          <button
                            class="ag-eo"
                            class:sel={sessions[mimar.key].chiefEffort === ef}
                            onclick={(e) => { e.stopPropagation(); sessions[mimar.key].setChiefModel(sessions[mimar.key].chiefModel, ef); agentModelMenu = null; }}
                          >{ef}</button>
                        {/each}
                      </div>
                    </div>
                  {/if}
                </div>
              </button>

              <button
                class="sb-group sb-group-gap sb-toggle"
                onclick={() => (advisorsOpen = !advisorsOpen)}
              >
                <span class="arc-caption">Advisors</span>
                <span class="sb-toggle-r">
                  {#if advisors.some((a) => unseen[a.key])}
                    <span class="sb-live-dot"></span>
                  {/if}
                  <span class="sb-count">{advisors.length}</span>
                  <Icon
                    name="chevronDown"
                    size={14}
                    class={advisorsOpen ? "sb-chev open" : "sb-chev"}
                  />
                </span>
              </button>
              {#if advisorsOpen}
                <div class="agent-list">
                  {#each advisors as a (a.key)}
                    <button class="agent" class:on={view === a.key} onclick={() => openAgent(a.key)}>
                      <Avatar
                        label={a.name}
                        icon={agentIcon(a.name, a.subtitle)}
                        size={34}
                        variant="soft"
                      />
                      <div class="agent-id">
                        <div class="agent-name">{a.name}</div>
                        <div class="agent-sub">{a.subtitle}</div>
                      </div>
                      {#if sessions[a.key].running}
                        <Badge variant="soft" tone="warn" dot pulse>In progress</Badge>
                      {:else if unseen[a.key]}
                        <Badge variant="soft" tone="ok" dot pulse>Ready</Badge>
                      {/if}
                      <!-- Advisor model/effort badge removed per UX request:
                           advisors should not show in the list (the user does not
                           change them like the Mimar). Model change is still available
                           in the advisor screen's own header (GlobalChief.svelte). -->
                    </button>
                  {/each}
                </div>
              {/if}

              <div class="sb-group sb-group-gap">
                <span class="arc-caption">Projects</span>
                <div class="sb-group-right">
                  <button
                    class="sb-refresh"
                    title="Refresh project logos"
                    aria-label="Refresh project logos"
                    disabled={refreshingLogos}
                    onclick={refreshLogos}
                  >
                    <Icon name={refreshingLogos ? "loader" : "refreshCw"} size={12} stroke={2.2} spin={refreshingLogos} />
                  </button>
                  <span class="sb-count">{projects.length}</span>
                </div>
              </div>

              {#if loading}
                <p class="sb-muted">Loading…</p>
              {:else if projects.length === 0}
                <p class="sb-muted">No projects yet.</p>
              {:else}
                <div class="project-list">
                  {#each projects as p (p.id)}
                    <button
                      class="project"
                      class:opening={openingProjectId === p.id}
                      disabled={openingProjectId === p.id}
                      onclick={() => openProject(p)}
                    >
                      <Avatar label={p.name} image={p.logoUri} size={32} variant="outline" />
                      <div class="agent-id">
                        <div class="agent-name">{p.name}</div>
                        <div class="agent-sub">
                          {#if openingProjectId === p.id}
                            <span class="opening-line">
                              <Icon name="loader" size={11} stroke={2.2} spin={true} />
                              Opening...
                            </span>
                          {:else}
                            {relativeTime(p.lastOpened)}
                          {/if}
                        </div>
                      </div>
                      <span
                        class="project-x"
                        class:report-on={p.reportEnabled}
                        role="button"
                        tabindex="0"
                        title={p.reportEnabled ? "Report-enabled (turn off)" : "Report-disabled (turn on)"}
                        aria-label="Toggle report suggestions"
                        onclick={(e) => toggleReportEnabled(e, p)}
                        onkeydown={(e) =>
                          e.key === "Enter" && toggleReportEnabled(e as unknown as MouseEvent, p)}
                      >
                        <Icon name={p.reportEnabled ? "bell" : "bellOff"} size={12} stroke={2.2} />
                      </span>
                      <span
                        class="project-x"
                        role="button"
                        tabindex="0"
                        title="Rename"
                        aria-label="Rename"
                        onclick={(e) => startRename(e, p)}
                        onkeydown={(e) =>
                          e.key === "Enter" && startRename(e as unknown as MouseEvent, p)}
                      >
                        <Icon name="edit" size={12} stroke={2.2} />
                      </span>
                      <span
                        class="project-x"
                        role="button"
                        tabindex="0"
                        title="Remove from list"
                        aria-label="Remove from list"
                        onclick={(e) => deleteProject(e, p)}
                        onkeydown={(e) =>
                          e.key === "Enter" && deleteProject(e as unknown as MouseEvent, p)}
                      >
                        <Icon name="x" size={12} stroke={2.4} />
                      </span>
                    </button>
                  {/each}
                </div>
              {/if}

              <div class="sb-foot">
                <Button variant="primary" icon="plus" onclick={newProject} disabled={busy}>
                  New project
                </Button>
              </div>
            </aside>

            <div class="center">
              {#each AGENTS as a (a.key)}
                <div class="agent-pane" style:display={view === a.key ? "block" : "none"}>
                  <GlobalChief
                    agentName={a.name}
                    agentPort={a.port}
                    mark={a.mark}
                    subtitle={a.subtitle}
                    hint={a.hint}
                    session={sessions[a.key]}
                    active={view === a.key}
                  />
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      {#each tabs as t (t.id)}
        <div class="pane project-pane" style:display={activeTab === t.id ? "block" : "none"}>
          <ProjectScreen
  projectId={t.id}
  projectName={t.name}
  port={t.port}
  active={activeTab === t.id}
  onBack={() => closeTab(t.id)}
  onActivityChange={(s) => {
    const isActive = activeTab === t.id;
    if (s === "busy") {
      // Running → orange. Including the active tab (we want to see active work too).
      tabActivity = new Map([...tabActivity, [t.id, "busy"]]);
    } else {
      // Work done: if I am on the active tab I count as having seen it → gray (clear).
      // Otherwise unread reply → green "unread".
      if (isActive) {
        const m = new Map(tabActivity); m.delete(t.id); tabActivity = m;
      } else {
        tabActivity = new Map([...tabActivity, [t.id, "unread"]]);
      }
    }
  }}
/>
        </div>
      {/each}
    </div>
  </div>
</div>

{#if renameTarget}
  <div
    class="rn-backdrop"
    role="button"
    tabindex="-1"
    aria-label="Cancel"
    onclick={() => (renameTarget = null)}
    onkeydown={(e) => e.key === "Escape" && (renameTarget = null)}
  ></div>
  <div class="rn-modal">
    <div class="rn-head">Rename project</div>
    <input
      class="rn-input"
      type="text"
      bind:value={renameDraft}
      onkeydown={(e) => {
        if (e.key === "Enter") applyRename();
        if (e.key === "Escape") renameTarget = null;
      }}
      placeholder="Project name"
    />
    <div class="rn-btns">
      <button class="rn-btn rn-cancel" onclick={() => (renameTarget = null)}>Cancel</button>
      <button class="rn-btn rn-ok" onclick={applyRename}>Save</button>
    </div>
  </div>
{/if}

<style>
  .shell {
    height: 100vh;
    display: flex;
    overflow: hidden;
  }

  /* NOTE: the .rail / .rail-* CSS blocks were moved into the NavRail.svelte component. */

  .stack {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  /* NOTE: .tabstrip / .tab / .tab-* / .tab-new + related keyframes were moved
     into the TabBar.svelte component. */

  /* Loading pane (overlay while a project opens) */
  .lp-pane {
    z-index: 20;
    background: var(--arc-surface);
    display: flex !important;
    align-items: center;
    justify-content: center;
    animation: lp-fadein 0.25s var(--arc-ease);
  }
  @keyframes lp-fadein {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .lp-center {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 18px;
    animation: lp-rise 0.35s var(--arc-ease);
  }
  @keyframes lp-rise {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .lp-avatar {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .lp-avatar-ring {
    position: absolute;
    inset: -10px;
    border-radius: 50%;
    border: 2px solid var(--arc-primary-soft);
    animation: lp-ring-pulse 1.6s var(--arc-ease) infinite;
  }
  @keyframes lp-ring-pulse {
    0%, 100% { transform: scale(1); opacity: 0.8; border-color: var(--arc-primary-soft); }
    50% { transform: scale(1.12); opacity: 0.3; border-color: var(--arc-accent); }
  }
  .lp-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--arc-text);
    letter-spacing: -0.3px;
  }
  .lp-sub {
    font-size: 13px;
    color: var(--arc-text-faint);
    margin-top: -8px;
  }
  .lp-bar {
    width: 180px;
    height: 3px;
    border-radius: 99px;
    background: var(--arc-n200);
    overflow: hidden;
  }
  .lp-bar-fill {
    height: 100%;
    border-radius: 99px;
    background: linear-gradient(90deg, var(--arc-primary), var(--arc-accent));
    animation: lp-progress 2s var(--arc-ease) infinite;
    transform-origin: left;
  }
  @keyframes lp-progress {
    0% { width: 0%; margin-left: 0%; }
    50% { width: 70%; margin-left: 15%; }
    100% { width: 0%; margin-left: 100%; }
  }

  .shell-body {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .pane {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }

  /* ---- Single screen (notes/usage) ---- */
  .screen {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--arc-bg);
  }
  .screen-head {
    flex-shrink: 0;
    padding: 16px 24px;
    background: var(--arc-surface);
    border-bottom: 1px solid var(--arc-border);
  }
  .screen-head .arc-caption {
    font-size: 9.5px;
  }
  .screen-title {
    font-size: 20px;
    font-weight: 700;
    color: var(--arc-text);
  }
  .screen-body {
    flex: 1;
    overflow-y: auto;
    padding: 22px 24px;
  }

  /* ---- Chat mode: sidebar + center ---- */
  .split {
    height: 100%;
    display: flex;
  }
  .sidebar {
    width: 300px;
    flex-shrink: 0;
    border-right: 1px solid var(--arc-border);
    background: var(--arc-surface);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 16px 14px 0;
    gap: 7px;
  }
  .sb-brand {
    padding: 2px 4px 8px;
  }
  .sb-brand-name {
    font-size: 17px;
    font-weight: 700;
    color: var(--arc-text);
    letter-spacing: -0.01em;
  }
  .sb-brand-sub {
    font-size: 11.5px;
    color: var(--arc-text-faint);
  }
  .sb-group {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 4px;
  }
  .sb-group-gap {
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--arc-border);
  }
  .sb-toggle {
    border: none;
    background: transparent;
    width: 100%;
    font: inherit;
    cursor: pointer;
    padding-bottom: 8px;
    border-radius: 0;
    transition: color 0.15s var(--arc-ease);
  }
  .sb-toggle:hover :global(.arc-caption) {
    color: var(--arc-text-soft);
  }
  .sb-toggle-r {
    display: flex;
    align-items: center;
    gap: 7px;
  }
  .sb-toggle :global(.sb-chev) {
    color: var(--arc-text-faint);
    transition: transform 0.18s var(--arc-ease);
  }
  .sb-toggle :global(.sb-chev.open) {
    transform: rotate(180deg);
  }
  /* Signals only an unread advisor reply → green, blinking. */
  .sb-live-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--arc-ok);
    animation: badge-pulse 1.2s var(--arc-ease) infinite;
  }
  @keyframes badge-pulse {
    50% {
      opacity: 0.3;
    }
  }
  .sb-group-right {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
  }
  .sb-count {
    font-size: 11px;
    font-weight: 600;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
    background: var(--arc-n100);
    border-radius: var(--arc-r-pill);
    padding: 2px 8px;
  }
  .sb-muted {
    color: var(--arc-text-faint);
    font-size: 12.5px;
    padding: 4px;
    margin: 0;
  }
  .agent-list,
  .project-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .agent,
  .project {
    width: 100%;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 9px;
    border: 1px solid transparent;
    border-radius: var(--arc-r-sm);
    background: transparent;
    transition: background 0.13s var(--arc-ease), border-color 0.13s var(--arc-ease);
  }
  .agent:hover,
  .project:hover {
    background: var(--arc-n50);
  }
  .project.opening {
    background: var(--arc-primary-soft);
    border-color: var(--arc-primary);
    cursor: progress;
    position: relative;
    overflow: hidden;
  }
  .project.opening::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent,
      var(--arc-primary-tint, rgba(15, 118, 110, 0.18)),
      transparent
    );
    animation: project-shimmer 1.2s linear infinite;
    pointer-events: none;
  }
  @keyframes project-shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
  .opening-line {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--arc-primary-strong);
    font-weight: 500;
  }
  .agent.on {
    background: var(--arc-primary-tint);
    border-color: var(--arc-primary-soft);
  }
  .agent-id {
    flex: 1;
    min-width: 0;
  }
  .agent-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--arc-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .agent-sub {
    font-size: 11px;
    color: var(--arc-text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .project-x {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    border-radius: 6px;
    color: var(--arc-text-faint);
    transition: background 0.12s var(--arc-ease), color 0.12s var(--arc-ease);
  }
  .project-x:hover {
    background: var(--arc-danger-soft);
    color: var(--arc-danger);
  }
  .project-x.report-on {
    color: var(--arc-primary);
  }
  .project-x.report-on:hover {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }
  .project-deploy {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    flex-shrink: 0;
    border-radius: 6px;
    color: var(--arc-primary);
    background: var(--arc-primary-soft);
  }
  /* Agent model/effort widget — sidebar */
  .ag-mw {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    border-radius: 5px;
    border: 1px solid var(--arc-border);
    background: var(--arc-n50, #f8f8f8);
    cursor: pointer;
    font-size: 10px;
    font-family: var(--arc-mono);
    color: var(--arc-text-faint);
    flex-shrink: 0;
    transition: border-color 0.12s, background 0.12s, color 0.12s;
    white-space: nowrap;
  }
  .ag-mw:hover {
    border-color: color-mix(in srgb, var(--arc-primary) 40%, transparent);
    background: var(--arc-primary-tint, rgba(15,118,110,0.06));
    color: var(--arc-primary);
  }
  .ag-mc { font-weight: 600; }
  .ag-dot { opacity: 0.4; }
  .ag-ec { opacity: 0.8; }
  .ag-mm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 999;
  }
  .ag-mm {
    position: absolute;
    right: 0;
    top: calc(100% + 4px);
    z-index: 1000;
    min-width: 160px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  }
  .ag-mo {
    width: 100%;
    text-align: left;
    padding: 5px 8px;
    border-radius: 5px;
    border: 1px solid transparent;
    background: transparent;
    font-size: 11px;
    font-family: var(--arc-mono);
    cursor: pointer;
    color: var(--arc-text);
    transition: background 0.1s;
  }
  .ag-mo:hover { background: var(--arc-n50); }
  .ag-mo.sel {
    background: var(--arc-primary-soft);
    color: var(--arc-primary);
    font-weight: 600;
  }
  .ag-er {
    display: flex;
    gap: 4px;
    margin-top: 2px;
  }
  .ag-eo {
    flex: 1;
    padding: 4px 4px;
    border-radius: 5px;
    border: 1px solid var(--arc-border);
    background: transparent;
    font-size: 10px;
    cursor: pointer;
    color: var(--arc-text-faint);
    transition: all 0.1s;
  }
  .ag-eo:hover { background: var(--arc-n50); border-color: var(--arc-text-faint); }
  .ag-eo.sel {
    background: var(--arc-primary-soft);
    border-color: var(--arc-primary);
    color: var(--arc-primary);
    font-weight: 600;
  }
  .sb-foot {
    position: sticky;
    bottom: 0;
    margin-top: auto;
    padding: 12px 0;
    background: var(--arc-surface);
    border-top: 1px solid var(--arc-border);
    display: flex;
  }
  .sb-foot :global(.btn) {
    flex: 1;
  }

  .center {
    flex: 1;
    min-width: 0;
    min-height: 0;
    position: relative;
  }
  .agent-pane {
    position: absolute;
    inset: 0;
  }

  /* Refresh logos button */
  .sb-refresh {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid var(--arc-border);
    background: var(--arc-surface);
    border-radius: 6px;
    color: var(--arc-text-soft);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
    line-height: 1;
  }
  .sb-refresh:hover:not(:disabled) {
    border-color: var(--arc-primary);
    background: var(--arc-primary-soft);
    color: var(--arc-primary);
  }
  .sb-refresh:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Rename modal */
  .rn-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(23, 26, 33, 0.4);
    backdrop-filter: blur(1.5px);
    z-index: 60;
  }
  .rn-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 61;
    width: 360px;
    max-width: 92vw;
    background: var(--arc-surface);
    border-radius: var(--arc-r-lg);
    box-shadow: var(--arc-shadow-lg);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .rn-head {
    font-size: 14px;
    font-weight: 600;
    color: var(--arc-text);
  }
  .rn-input {
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    padding: 9px 11px;
    font: inherit;
    font-size: 14px;
    color: var(--arc-text);
    background: var(--arc-surface-2);
    outline: none;
  }
  .rn-input:focus {
    border-color: var(--arc-primary);
    box-shadow: 0 0 0 3px var(--arc-primary-soft);
  }
  .rn-btns {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .rn-btn {
    border: 1px solid var(--arc-border);
    background: var(--arc-surface-2);
    color: var(--arc-text-soft);
    border-radius: var(--arc-r-sm);
    padding: 7px 14px;
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
  }
  .rn-cancel:hover {
    border-color: var(--arc-text-soft);
    color: var(--arc-text);
  }
  .rn-ok {
    background: var(--arc-primary);
    color: #fff;
    border-color: var(--arc-primary);
  }
  .rn-ok:hover {
    background: var(--arc-primary-hover);
  }
</style>
