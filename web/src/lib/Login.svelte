<script lang="ts">
  import { relay } from "./relay.svelte";

  let username = $state("");
  let password = $state("");

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (username && password) relay.login(username, password);
  }
</script>

<div class="screen">
  <form class="box arc-card" onsubmit={submit}>
    <div class="mark">A</div>
    <h1>Architect</h1>
    <p class="sub">Uzaktan erişim</p>

    <label>
      <span class="arc-caption">Kullanıcı adı</span>
      <input bind:value={username} autocomplete="username" />
    </label>
    <label>
      <span class="arc-caption">Şifre</span>
      <input type="password" bind:value={password} autocomplete="current-password" />
    </label>

    {#if relay.loginError}
      <p class="err">{relay.loginError}</p>
    {/if}

    <button class="arc-btn arc-btn-primary" disabled={relay.loggingIn}>
      {relay.loggingIn ? "Giriş yapılıyor…" : "Giriş yap"}
    </button>
  </form>
</div>

<style>
  .screen {
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 20px;
    background: var(--arc-grad-header);
  }

  .box {
    width: 100%;
    max-width: 360px;
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .mark {
    width: 52px;
    height: 52px;
    border-radius: 13px;
    background: var(--arc-primary);
    color: #fff;
    display: grid;
    place-items: center;
    font-size: 26px;
    font-weight: 800;
    margin: 0 auto;
  }

  h1 {
    margin: 6px 0 0;
    text-align: center;
    font-size: 21px;
  }

  .sub {
    margin: 0 0 8px;
    text-align: center;
    color: var(--arc-text-soft);
    font-size: 13px;
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  input {
    border: 1px solid var(--arc-border);
    border-radius: var(--arc-radius-sm);
    padding: 11px 12px;
    font-size: 15px;
    outline: none;
  }

  input:focus {
    border-color: var(--arc-primary);
  }

  .err {
    margin: 0;
    color: var(--arc-danger);
    background: var(--arc-danger-soft);
    border-radius: var(--arc-radius-sm);
    padding: 8px 10px;
    font-size: 13px;
  }

  button {
    margin-top: 4px;
  }
</style>
