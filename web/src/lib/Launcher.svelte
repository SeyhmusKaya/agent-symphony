<script lang="ts">
  import { relay, type Project } from "./relay.svelte";

  function relativeTime(ms: number): string {
    const min = Math.floor((Date.now() - ms) / 60000);
    if (min < 1) return "az önce";
    if (min < 60) return `${min} dk önce`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} sa önce`;
    return `${Math.floor(hr / 24)} gün önce`;
  }

  function initial(name: string): string {
    return name.trim().charAt(0).toUpperCase() || "?";
  }

  function open(p: Project) {
    relay.openProject(p);
  }
</script>

<div class="page">
  <header class="hero">
    <div class="brand">
      <div class="mark">A</div>
      <div>
        <div class="name">Architect</div>
        <div class="sub">Uzaktan erişim</div>
      </div>
    </div>
    <span class="conn" class:on={relay.pcOnline}>
      {relay.pcOnline ? "PC bağlı" : "PC çevrimdışı"}
    </span>
  </header>

  <main class="body">
    <div class="head-row">
      <span class="arc-caption">Projeler</span>
      <button class="refresh" onclick={() => relay.refreshProjects()}>Yenile</button>
    </div>

    {#if !relay.pcOnline}
      <div class="note arc-card">
        PC çevrimdışı. Masaüstündeki Architect ve tünel açık olmalı.
      </div>
    {:else if relay.projects.length === 0}
      <div class="note arc-card">Henüz proje yok.</div>
    {:else}
      <ul class="list">
        {#each relay.projects as p (p.id)}
          <li>
            <button class="card arc-card" onclick={() => open(p)}>
              <div class="avatar">{initial(p.name)}</div>
              <div class="info">
                <div class="pname">{p.name}</div>
                <div class="ppath">{p.path}</div>
              </div>
              <div class="time">{relativeTime(p.lastOpened)}</div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </main>
</div>

<style>
  .page {
    min-height: 100vh;
  }

  .hero {
    background: var(--arc-grad-header);
    color: #fff;
    padding: 18px 18px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 11px;
  }

  .mark {
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.16);
    border: 1px solid rgba(255, 255, 255, 0.28);
    display: grid;
    place-items: center;
    font-size: 20px;
    font-weight: 800;
  }

  .name {
    font-size: 17px;
    font-weight: 800;
  }

  .sub {
    font-size: 11px;
    opacity: 0.82;
  }

  .conn {
    font-size: 11px;
    font-weight: 700;
    padding: 3px 9px;
    border-radius: 20px;
    background: rgba(255, 255, 255, 0.14);
  }

  .conn.on {
    background: rgba(20, 184, 166, 0.4);
  }

  .body {
    padding: 18px 16px 40px;
    max-width: 640px;
    margin: 0 auto;
  }

  .head-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .refresh {
    border: 1px solid var(--arc-border);
    background: var(--arc-surface);
    color: var(--arc-primary);
    border-radius: 7px;
    padding: 5px 11px;
    font-size: 12px;
    font-weight: 600;
  }

  .note {
    padding: 18px;
    color: var(--arc-text-soft);
    font-size: 13px;
    text-align: center;
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .card {
    width: 100%;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 14px;
  }

  .card:active {
    border-color: var(--arc-primary);
  }

  .avatar {
    width: 42px;
    height: 42px;
    flex-shrink: 0;
    border-radius: 11px;
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
    display: grid;
    place-items: center;
    font-size: 18px;
    font-weight: 800;
  }

  .info {
    flex: 1;
    min-width: 0;
  }

  .pname {
    font-size: 15px;
    font-weight: 700;
  }

  .ppath {
    font-size: 11px;
    color: var(--arc-text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .time {
    font-size: 11px;
    color: var(--arc-text-soft);
    white-space: nowrap;
  }
</style>
