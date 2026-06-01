<script lang="ts">
  import type { ProjectSession } from "$lib/store.svelte";
  import Icon from "$lib/icons/Icon.svelte";
  import ContextGauge from "$lib/ui/ContextGauge.svelte";
  import ChatBgPicker from "$lib/ui/ChatBgPicker.svelte";
  import BudgetCard from "$lib/budget/BudgetCard.svelte";
  import { EFFORTS } from "$lib/router/helpers.js";

  // The SHARED right-hand part of the Mimar (GlobalChief) and Sef (ProjectScreen)
  // top toolbars. Plan / context gauge / session-$ / hourly-$ / model-widget /
  // chat-bg-picker — all consistent. The design is identical on both screens.
  interface Props {
    session: ProjectSession;
  }
  const { session }: Props = $props();

  let modelMenuOpen = $state(false);
  // F4 (Cost Control): click the Budget badge -> BudgetCard dropdown.
  let budgetMenuOpen = $state(false);
  // Provider keys panel (DeepSeek / Anthropic). Inputs are write-only — the key
  // value never comes back from the backend, so fields start empty.
  let keysOpen = $state(false);
  let dsKeyInput = $state("");
  let anKeyInput = $state("");
  let keysSaved = $state(false);
  const providerLabel = $derived(
    session.provider === "deepseek"
      ? "DeepSeek (oncelik)"
      : session.provider === "anthropic-key"
        ? "Anthropic API key"
        : "Anthropic Max (OAuth)",
  );
  function saveKeys() {
    session.setProviders(dsKeyInput.trim(), anKeyInput.trim());
    keysSaved = true;
    dsKeyInput = "";
    anKeyInput = "";
    setTimeout(() => (keysSaved = false), 2500);
  }
  // Self role: sessionsIsGlobal=true -> Mimar; otherwise chief. The advisor uses
  // a separate screen (this toolbar is only on the Mimar/Sef surface).
  const selfRole = $derived<"chief" | "mimar" | "specialist" | "advisor" | "worker">(
    session.sessionsIsGlobal ? "mimar" : "chief",
  );
  // Budget badge tone — based on pctUsed thresholds.
  const budgetTone = $derived.by(() => {
    const b = session.budgets;
    if (!b || !b.agents.length) return "ok";
    const top = b.agents[0];
    if (top.pctUsed >= 0.8 || b.hourlyAlarm) return "red";
    if (top.pctUsed >= 0.5) return "amber";
    return "ok";
  });
</script>

<div class="ct">
  <button
    class="ct-plan"
    class:on={session.planMode}
    title={session.planMode ? "Plan mode on (click to disable)" : "Plan mode off (click to enable)"}
    onclick={() => session.control(session.planMode ? "plan_kapat" : "plan_ac")}
  >
    <Icon name="sparkles" size={14} stroke={2} />
    <span>Plan</span>
  </button>

  <ContextGauge
    used={session.contextTokens}
    total={session.contextWindow}
    onclick={() => session.sendCommand("/compact")}
  />

  <!-- Fix 119: ALWAYS show the Session $ / Hourly $ badges on every project.
       Previously they were conditioned on `> 0`; on projects with zero spend (e.g.
       EmlakCopilot) they disappeared from the header, while on busy ones (google
       reviews) they showed -> inconsistent look. With a plain $0 zero-state on zero
       value, the same layout appears everywhere. -->
  <span class="ct-sep"></span>

  <span
    class="ct-usd"
    data-tone={session.sessionUsd < 1 ? "ok" : session.sessionUsd < 5 ? "warn" : session.sessionUsd < 20 ? "hot" : "red"}
    title="Accumulated $ cost over the session (sum of all chief turns since the process started)."
  >
    Session ${session.sessionUsd > 0 && session.sessionUsd < 1 ? session.sessionUsd.toFixed(3) : session.sessionUsd.toFixed(2)}
  </span>
  <span
    class="ct-hourly"
    data-tone={session.hourlyUsd < 1 ? "ok" : session.hourlyUsd < 3 ? "warn" : session.hourlyUsd < 10 ? "hot" : "red"}
    title="$ spent in the last 1 hour (rolling window). A high tempo means it is running expensive."
  >
    ${session.hourlyUsd > 0 && session.hourlyUsd < 1 ? session.hourlyUsd.toFixed(3) : session.hourlyUsd.toFixed(2)}/hour
  </span>

  {#if session.budgets}
    <span class="ct-sep"></span>
    <div class="ct-budget">
      <button
        type="button"
        class="ct-budget-chip"
        data-tone={budgetTone}
        onclick={() => (budgetMenuOpen = !budgetMenuOpen)}
        title="Daily budget — click for detail"
      >
        <Icon name="sparkles" size={12} stroke={2} />
        <span class="ct-budget-pct">
          {Math.round((session.budgets.agents[0]?.pctUsed ?? 0) * 100)}%
        </span>
      </button>
      {#if budgetMenuOpen}
        <div
          class="ct-backdrop"
          role="button"
          tabindex="-1"
          aria-label="Close"
          onclick={() => (budgetMenuOpen = false)}
          onkeydown={(e) => e.key === "Escape" && (budgetMenuOpen = false)}
        ></div>
        <div class="ct-budget-menu">
          <BudgetCard
            budgets={session.budgets}
            sessionUsd={session.sessionUsd}
            hourlyUsd={session.hourlyUsd}
            {session}
            {selfRole}
          />
        </div>
      {/if}
    </div>
  {/if}

  <span class="ct-sep"></span>

  <div class="ct-model">
    <button class="ct-chip" onclick={() => (modelMenuOpen = !modelMenuOpen)}>
      <Icon name="cpu" size={14} />
      <span class="ct-chip-txt">{session.chiefModel}</span>
      <span class="ct-chip-eff">{session.chiefEffort}</span>
      {#if session.chiefFast}
        <span class="ct-chip-fast" title="Fast mode on (priority service tier)">
          <Icon name="zap" size={11} stroke={2.4} />
        </span>
      {/if}
      <Icon name="chevronDown" size={13} />
    </button>
    {#if modelMenuOpen}
      <div
        class="ct-backdrop"
        role="button"
        tabindex="-1"
        aria-label="Close"
        onclick={() => (modelMenuOpen = false)}
        onkeydown={(e) => e.key === "Escape" && (modelMenuOpen = false)}
      ></div>
      <div class="ct-menu arc-card">
        <span class="arc-caption">Model</span>
        {#each session.availableModels as m (m)}
          <button
            class="ct-opt"
            class:sel={session.chiefModel === m}
            onclick={() => session.setChiefModel(m, session.chiefEffort)}
          >
            <span>{m}</span>
            {#if session.chiefModel === m}
              <Icon name="check" size={14} stroke={2.4} />
            {/if}
          </button>
        {/each}
        <span class="arc-caption">Effort</span>
        <div class="ct-eff-row">
          {#each EFFORTS as ef (ef)}
            <button
              class="ct-eff-opt"
              class:sel={session.chiefEffort === ef}
              onclick={() => session.setChiefModel(session.chiefModel, ef)}
            >
              {ef}
            </button>
          {/each}
        </div>
        <span class="arc-caption">Fast mode</span>
        <button
          class="ct-fast-toggle"
          class:on={session.chiefFast}
          onclick={() => session.setChiefModel(session.chiefModel, session.chiefEffort, !session.chiefFast)}
          title="Priority service tier: when the account has capacity, requests enter the fast queue; otherwise they fall back to standard automatically (no errors)."
        >
          <span class="ct-fast-label">
            <Icon name="zap" size={13} stroke={2.2} />
            <span>Fast response</span>
          </span>
          <span class="ct-fast-switch" class:on={session.chiefFast}>
            <span class="ct-fast-knob"></span>
          </span>
        </button>

        <div class="ct-prov-row">
          <span class="arc-caption">Provider</span>
          <span class="ct-prov-badge" data-p={session.provider}>{providerLabel}</span>
        </div>
        <button class="ct-keys-toggle" onclick={() => (keysOpen = !keysOpen)}>
          <Icon name="wrench" size={13} stroke={2.2} />
          <span>API anahtarlari</span>
          <Icon name={keysOpen ? "chevronDown" : "chevronRight"} size={13} stroke={2.2} />
        </button>
        {#if keysOpen}
          <div class="ct-keys">
            <label class="ct-key-field">
              <span>DeepSeek API key</span>
              <input
                type="password"
                placeholder={session.provider === "deepseek" ? "kayitli (degistirmek icin yaz)" : "sk-..."}
                bind:value={dsKeyInput}
                autocomplete="off"
                spellcheck="false"
              />
            </label>
            <label class="ct-key-field">
              <span>Anthropic API key (opsiyonel)</span>
              <input
                type="password"
                placeholder="sk-ant-... (bos = Max OAuth)"
                bind:value={anKeyInput}
                autocomplete="off"
                spellcheck="false"
              />
            </label>
            <button class="ct-keys-save" onclick={saveKeys}>
              {keysSaved ? "Kaydedildi" : "Kaydet + uygula"}
            </button>
            <span class="ct-keys-note">
              DeepSeek key girilince oncelik DeepSeek olur; sef/danisman v4-pro, uzman v4-flash.
              Bu pencere acik projede aninda; diger ajanlar bir sonraki restart'ta.
            </span>
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <ChatBgPicker />
</div>

<style>
  .ct {
    display: flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
  }

  /* Align ContextGauge at 32px height */
  .ct :global(.gauge) {
    height: 32px;
    padding: 0 8px;
  }

  .ct-sep {
    width: 1px;
    height: 18px;
    background: var(--arc-border);
    flex-shrink: 0;
    margin: 0 2px;
    display: inline-block;
  }

  /* ---- Plan ---- */
  .ct-plan {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: var(--arc-r-sm);
    border: 1px solid var(--arc-border);
    background: var(--arc-surface-2);
    color: var(--arc-text-soft);
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .ct-plan:hover {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
  }
  .ct-plan.on {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
    border-color: var(--arc-primary);
    font-weight: 600;
  }

  /* ---- Session $ / Hourly $ badges ---- */
  .ct-usd {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 11px;
    border-radius: var(--arc-r-pill);
    border: 1px solid currentColor;
    font-family: var(--arc-mono);
    font-size: 11.5px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .ct-usd[data-tone="ok"]   { color: #16a34a; }
  .ct-usd[data-tone="warn"] { color: #ca8a04; }
  .ct-usd[data-tone="hot"]  { color: #ea580c; }
  .ct-usd[data-tone="red"]  {
    color: var(--arc-danger);
    background: color-mix(in srgb, var(--arc-danger) 10%, transparent);
  }
  .ct-hourly {
    display: inline-flex;
    align-items: center;
    height: 32px;
    padding: 0 10px;
    border-radius: var(--arc-r-pill);
    border: 1px dashed currentColor;
    background: color-mix(in srgb, currentColor 6%, transparent);
    font-family: var(--arc-mono);
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .ct-hourly[data-tone="ok"]   { color: #16a34a; }
  .ct-hourly[data-tone="warn"] { color: #ca8a04; }
  .ct-hourly[data-tone="hot"]  { color: #ea580c; }
  .ct-hourly[data-tone="red"]  { color: var(--arc-danger); }

  /* ---- F4 Budget badge ---- */
  .ct-budget {
    position: relative;
    flex-shrink: 0;
  }
  .ct-budget-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 32px;
    padding: 0 11px;
    border-radius: var(--arc-r-pill);
    border: 1px solid var(--arc-border);
    background: var(--arc-surface);
    color: var(--arc-text-soft);
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s, transform 0.15s var(--arc-ease);
  }
  .ct-budget-chip:hover {
    transform: translateY(-1px);
    border-color: #0f766e;
    color: #0f766e;
    background: color-mix(in srgb, #14b8a6 6%, transparent);
  }
  .ct-budget-chip[data-tone="amber"] {
    color: #b45309;
    border-color: color-mix(in srgb, #d97706 50%, var(--arc-border));
    background: color-mix(in srgb, #fbbf24 12%, transparent);
  }
  .ct-budget-chip[data-tone="red"] {
    color: #b91c1c;
    border-color: color-mix(in srgb, #dc2626 60%, var(--arc-border));
    background: color-mix(in srgb, #f87171 14%, transparent);
  }
  .ct-budget-pct {
    font-family: var(--arc-mono);
    font-weight: 700;
  }
  .ct-budget-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 31;
    animation: ct-pop-in 0.14s var(--arc-ease);
  }

  /* ---- Model widget ---- */
  .ct-model {
    position: relative;
  }
  .ct-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-r-sm);
    padding: 0 10px;
    font-size: 11.5px;
    font-weight: 500;
    font-family: inherit;
    color: var(--arc-text-soft);
    cursor: pointer;
    transition: border-color 0.15s var(--arc-ease);
  }
  .ct-chip:hover {
    border-color: var(--arc-primary);
    color: var(--arc-primary);
  }
  .ct-chip-txt {
    font-family: var(--arc-mono);
  }
  .ct-chip-eff {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
    border-radius: var(--arc-r-pill);
    padding: 1px 7px;
    font-size: 10px;
    font-weight: 600;
  }
  /* Lightning badge on the chip when Fast is on — amber accent. */
  .ct-chip-fast {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #d97706;
  }

  .ct-backdrop {
    position: fixed;
    inset: 0;
    z-index: 30;
  }
  .ct-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 31;
    width: 244px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    box-shadow: var(--arc-shadow-lg);
    animation: ct-pop-in 0.14s var(--arc-ease);
  }
  @keyframes ct-pop-in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
  .ct-opt {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    text-align: left;
    border: 1px solid var(--arc-border);
    background: var(--arc-surface-2);
    border-radius: var(--arc-r-sm);
    padding: 8px 10px;
    font-size: 11.5px;
    font-family: var(--arc-mono);
    font-weight: 500;
    color: var(--arc-text-soft);
    cursor: pointer;
    transition: border-color 0.15s var(--arc-ease);
  }
  .ct-opt:hover {
    border-color: var(--arc-primary);
  }
  .ct-opt.sel {
    background: var(--arc-primary-soft);
    color: var(--arc-primary-strong);
    border-color: var(--arc-primary);
  }
  .ct-eff-row {
    display: flex;
    gap: 5px;
  }
  .ct-eff-opt {
    flex: 1;
    border: 1px solid var(--arc-border);
    background: var(--arc-surface-2);
    border-radius: var(--arc-r-sm);
    padding: 6px;
    font-size: 11px;
    font-weight: 500;
    font-family: inherit;
    color: var(--arc-text-soft);
    cursor: pointer;
    transition: border-color 0.15s var(--arc-ease);
  }
  .ct-eff-opt:hover {
    border-color: var(--arc-primary);
  }
  .ct-eff-opt.sel {
    background: var(--arc-primary);
    color: #fff;
    border-color: var(--arc-primary);
  }

  /* ---- Fast mode toggle ---- */
  .ct-fast-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    border: 1px solid var(--arc-border);
    background: var(--arc-surface-2);
    border-radius: var(--arc-r-sm);
    padding: 8px 10px;
    font-family: inherit;
    cursor: pointer;
    transition: border-color 0.15s var(--arc-ease), background 0.15s var(--arc-ease);
  }
  .ct-fast-toggle:hover {
    border-color: #d97706;
  }
  .ct-fast-toggle.on {
    border-color: color-mix(in srgb, #d97706 55%, var(--arc-border));
    background: color-mix(in srgb, #fbbf24 12%, transparent);
  }
  .ct-fast-label {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--arc-text-soft);
  }
  .ct-fast-toggle.on .ct-fast-label {
    color: #b45309;
  }
  .ct-fast-switch {
    position: relative;
    width: 34px;
    height: 18px;
    border-radius: var(--arc-r-pill);
    background: var(--arc-border);
    flex-shrink: 0;
    transition: background 0.18s var(--arc-ease);
  }
  .ct-fast-switch.on {
    background: #d97706;
  }
  .ct-fast-knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    transition: transform 0.18s var(--arc-ease);
  }
  .ct-fast-switch.on .ct-fast-knob {
    transform: translateX(16px);
  }
  .ct-prov-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid var(--arc-border);
  }
  .ct-prov-badge {
    font-size: 10.5px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: var(--arc-r-pill);
    background: var(--arc-surface);
    border: 1px solid var(--arc-border);
    color: var(--arc-text-soft);
  }
  .ct-prov-badge[data-p="deepseek"] {
    color: #fff;
    background: linear-gradient(135deg, #0f766e, #14b8a6);
    border-color: transparent;
  }
  .ct-keys-toggle {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 7px 9px;
    border-radius: var(--arc-r-sm);
    border: 1px solid var(--arc-border);
    background: var(--arc-surface);
    color: var(--arc-text-soft);
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s var(--arc-ease);
  }
  .ct-keys-toggle:hover {
    background: var(--arc-primary-soft);
  }
  .ct-keys-toggle span {
    flex: 1;
    text-align: left;
  }
  .ct-keys {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 4px 2px 2px;
  }
  .ct-key-field {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .ct-key-field span {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--arc-text-faint);
  }
  .ct-key-field input {
    font-size: 11.5px;
    font-family: var(--arc-mono);
    padding: 6px 8px;
    border-radius: var(--arc-r-sm);
    border: 1px solid var(--arc-border);
    background: var(--arc-bg);
    color: var(--arc-text);
    outline: none;
  }
  .ct-key-field input:focus {
    border-color: var(--arc-primary);
  }
  .ct-keys-save {
    padding: 7px 9px;
    border-radius: var(--arc-r-sm);
    border: none;
    background: var(--arc-primary);
    color: #fff;
    font-size: 11.5px;
    font-weight: 700;
    cursor: pointer;
    transition: filter 0.12s var(--arc-ease);
  }
  .ct-keys-save:hover {
    filter: brightness(1.08);
  }
  .ct-keys-note {
    font-size: 10px;
    line-height: 1.45;
    color: var(--arc-text-faint);
  }
</style>
