<script lang="ts">
  import { onMount } from "svelte";
  import { relay } from "./lib/relay.svelte";
  import Login from "./lib/Login.svelte";
  import Launcher from "./lib/Launcher.svelte";
  import ProjectView from "./lib/ProjectView.svelte";

  onMount(() => relay.tryResume());
</script>

{#if relay.stage === "login"}
  <Login />
{:else if relay.stage === "launcher"}
  <Launcher />
{:else}
  <ProjectView />
{/if}
