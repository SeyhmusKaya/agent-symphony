// Tool groups — the disallowedTools list sent to the SDK is built based on the
// command content and chief type. Purpose: remove rarely used tool definitions
// from the model's context, reducing input token waste.
//
// Two additional mechanisms:
//   1) Regex intent: an extra group is auto-enabled by words in the message.
//   2) load_toolset tool: sef bir tur icinde acikca grup ister. Mimar bu tool'u
//      her zaman gorur (CORE icinde). Tek seferlik bir extraGroups listesi
//      yaratir; sonraki tura tasinmaz.

const MCP_PREFIX = "mcp__architect__";

// HER ZAMAN aktif — temel orkestrasyon + dosya/hafiza/loglama.
// Nadir kullanilan teshis/rapor tool'lari DIAG grupuna tasindi (niyet bazli).
const CORE: readonly string[] = [
  "ask_user_choice",
  // Faz 1 (Task #98) + F1.3a (Secenek B): SDK native paralel subagent. Sef
  // "Agent" tool ile registry'deki uzmanlari isolated context'te paralel
  // spawn eder. Cold start cache_create sifir (paylasilan prefix).
  // delegate / background_delegate / request_from_peer tool'lari kaldirildi —
  // hepsi Agent ile yapilir.
  "Agent",
  "spawn_worker",
  "spawn_workers_parallel",
  "task",
  "list_agents",
  "list_projects",
  "talk_to_chief",
  // Fix 55: cross-agent chat history erisimi.
  "get_agent_chat",
  "message_agent",
  "note_add",
  "note_list",
  "note_search",
  // memory_* araclari (search/get/remember/done) kaldirildi — kullanici talebi.
  // Fix 149: tool_catalog_* CORE'dan CATALOG grubuna tasindi (lazy). Nis kullanim
  // (GitHub arac katalog kesfi) — her turun tabaninda durmasi gereksiz ~1.4k tok.
  // Fix 137: list_servers CORE'a alindi (read-only, ~150 token). Eski durumda
  // SSH grubunda gated'di; buildAllowedToolNames prompt'u yok saydigi icin
  // (cache stability) RX_SSH ile auto-acilmiyordu → sef kendi atanmis
  // sunucusunu GOREMIYOR, "sunucuya erisimim yok" diye yanlis varsayip baska
  // sef/uzman'dan yardim istiyordu. Artik her sef list_servers ile atanmis
  // sunucularini gorur; ssh_run/deploy icin load_toolset(['ssh']) yine gerekir.
  "list_servers",
  // F1.3b: list_background_tasks kaldirildi (bgTasks subsystem'i silindi).
  "load_toolset",
  "unload_toolset",
  // CodeGraph: SABIT yuklenir (cache prefix stability). Plan: "varsayilan acik".
  // Bash grep yerine sef once bunlari kullansin.
  "code_search",
  "code_node",
  "code_callers",
  "code_callees",
  "code_impact",
  "code_imports",
  "code_files",
  "code_stats",
  // Fix 149: start/pause/resume/cancel/list_autonomous_jobs CORE'dan AUTONOMOUS
  // grubuna tasindi (lazy). Otonom 3-gun modu nadir + acikca tetiklenir; her
  // turun tabaninda 5 sema (~1.7k tok) durmasi gereksizdi. Kullanici "otonom
  // calis" derse sef load_toolset(['autonomous']) ile acar.
];

// Teshis / rapor / log / model degistirme / template — nadir, niyet bazli ac.
// F4: get_budget_report + set_budget_cap DIAG'a — sef "butce raporu" /
// "cap ayarla" niyetinde load_toolset ile acar; UI BudgetCard zaten status
// payload'tan canli okuyor, MCP tool agent-driven kullanim icin.
const DIAG: readonly string[] = [
  "read_logs",
  "log_search",
  "audit_search",
  "daily_report",
  "tool_usage_report",
  "set_agent_model",
  "list_templates",
  "get_budget_report",
  "set_budget_cap",
];

// Git operasyonlari — her sef her komutta commit atabilir, hep aktif tut.
const GIT: readonly string[] = ["git_commit", "git_push"];

// Ajan yonetimi — yeni uzman kurma, import/export, proje bilgisi.
// F2: skill yonetimi (attach/detach/list_skills) AGENT_MGMT grubunda. Mimar
// uzman/danisman/sef olusturup ardindan attach_skill ile her birine ozel
// SKILL.md eklesin. Kategori uyumlu (registry + skill = ajan tanimlama).
const AGENT_MGMT: readonly string[] = [
  "create_agent",
  "remove_agent",
  "export_agent",
  "import_agent",
  "set_project_info",
  "note_update",
  "note_delete",
  "attach_skill",
  "detach_skill",
  "list_skills",
  // Fix 143: load_skill (uzmana skill yukler) eskiden PLUGIN grubundaydi ->
  // RX_PLUGIN gated -> sef/Mimar default kumesinde YOKTU ("load_skill tool'una
  // sahip degil"). Kategori dogru yeri burasi (ajan/skill yonetimi). Tasindi.
  "load_skill",
];

// Fix 149: Otonom 3-gun modu — nadir, acikca load_toolset(['autonomous']).
const AUTONOMOUS: readonly string[] = [
  "start_autonomous_job",
  "pause_autonomous_job",
  "resume_autonomous_job",
  "cancel_autonomous_job",
  "list_autonomous_jobs",
];

// Fix 149: GitHub arac katalogu — nis kesif, load_toolset(['catalog']).
const CATALOG: readonly string[] = [
  "tool_catalog_search",
  "tool_catalog_list",
  "tool_catalog_add",
  "tool_catalog_remove",
];

// Sunucu/SSH — yalniz deploy/sunucu komutlarinda.
const SSH: readonly string[] = [
  "ssh_hetzner",
  "ssh_run",
  "list_servers",
  "ssh_sifre",
  "deploy_project",
];

// Gizli bilgi kasasi — yalniz secret/key sozcukleri varsa.
const VAULT: readonly string[] = ["vault_set", "vault_get", "vault_list", "vault_delete"];

// MEMORY_WRITE grubu (memory_set/forget) kaldirildi — kullanici talebi.

// Sistem — Mimar icin restart/report/cross-agent. Mimar default kumesinde aciktir.
// F1.3a: request_from_peer kaldirildi (Agent tool ile yapilir).
const SYSTEM: readonly string[] = [
  "restart_self",
  "restart_agent",
  "report_to_mimar",
  "call_remote_agent",
];

// Resim uretimi — yalniz "resim/gorsel" niyetinde.
const IMAGE: readonly string[] = ["generate_image", "chatgpt_login"];

// Guvenlik taramasi — yalniz "guvenlik/scan" niyetinde.
const SECURITY: readonly string[] = ["security_scan"];

// UI rebuild — yalniz UI/frontend degisikliginde.
const UI: readonly string[] = ["rebuild_ui"];

// Plugin & MCP yonetimi — admin islemleri, varsayilan kapali.
const PLUGIN: readonly string[] = [
  "load_plugin",
  "unload_plugin",
  "list_plugins",
  "load_skill",
];
const MCP_MGMT: readonly string[] = [
  "add_mcp_server",
  "list_mcp_servers",
  "remove_mcp_server",
];

// Fix 69: External MCP server lazy-load gate'leri. Bu gruplar architect-chief
// tool listesini DEGISTIRMEZ — sadece main.ts'in extraMcp filter'inde sinyal:
// "mcp_n8n" load_toolset ile acilirsa n8n server SDK mcpServers'a dahil edilir.
// Boylece n8n (~7 tool) ve windows (~12 tool) default'ta tasinmaz. Toplam
// tool catalog ~45 tool azalir, cold-cache ~10-15k token tasarruf.
const MCP_N8N: readonly string[] = [];
const MCP_WINDOWS: readonly string[] = [];

// Code graph — moved to CORE (cache prefix stability). The old intent-based
// access was removed: code_* tools are always enabled, the chief should use
// these before Bash grep.
const CODEGRAPH: readonly string[] = [];

const ALL_MCP: readonly string[] = [
  ...CORE,
  ...DIAG,
  ...GIT,
  ...AGENT_MGMT,
  ...AUTONOMOUS,
  ...CATALOG,
  ...SSH,
  ...VAULT,
  ...SYSTEM,
  ...IMAGE,
  ...SECURITY,
  ...UI,
  ...PLUGIN,
  ...MCP_MGMT,
  ...CODEGRAPH,
];

// Grup adi -> tool listesi haritasi (load_toolset icin).
export const GROUP_MAP: Record<string, readonly string[]> = {
  diag: DIAG,
  agent_mgmt: AGENT_MGMT,
  autonomous: AUTONOMOUS,
  catalog: CATALOG,
  ssh: SSH,
  vault: VAULT,
  system: SYSTEM,
  image: IMAGE,
  security: SECURITY,
  ui: UI,
  plugin: PLUGIN,
  mcp_mgmt: MCP_MGMT,
  codegraph: CODEGRAPH,
  mcp_n8n: MCP_N8N,
  mcp_windows: MCP_WINDOWS,
};

// Fix 69: external MCP server gate adlarinin sabit listesi. main.ts bu
// listeyi okur, persistedToolsets icinde varsa karsilik gelen MCP server'i
// SDK mcpServers config'ine ekler. Yoksa server hic baglanmaz, tool schema'sini
// catalog'a koymaz.
export const EXTERNAL_MCP_GATES: Record<string, string> = {
  mcp_n8n: "n8n",
  mcp_windows: "windows",
};

// load_toolset tool kullanicisi icin ozet — system prompt'ta gosterilir.
export const GROUP_SUMMARY: Record<string, string> = {
  diag: "read_logs, log_search, audit_search, daily_report, tool_usage_report, set_agent_model, list_templates, get_budget_report, set_budget_cap",
  agent_mgmt: "Yeni uzman kurma, import/export, set_project_info, note duzenleme, attach/detach/list_skills",
  autonomous: "start/pause/resume/cancel/list_autonomous_jobs — otonom 3-gun modu (cok-gunluk gorev)",
  catalog: "tool_catalog_search/list/add/remove — GitHub arac katalogu kesfi",
  ssh: "ssh_run, ssh_hetzner, list_servers, ssh_sifre, deploy_project",
  vault: "vault_set/get/list/delete — gizli bilgi kasasi",
  system: "restart_self, restart_agent (Mimar: tek ajan yeniden baslat), report_to_mimar, call_remote_agent",
  image: "generate_image, chatgpt_login — gorsel uretimi",
  security: "security_scan — URL security audit",
  ui: "rebuild_ui — Tauri exe sifirdan derle",
  plugin: "load/unload/list_plugin, load_skill",
  mcp_mgmt: "add/remove/list MCP sunucusu",
  codegraph: "code_search, code_node, code_callers, code_callees, code_impact, code_imports, code_files, code_stats",
  mcp_n8n: "n8n MCP server (search_workflows/nodes/executions, list_credentials vb. ~7 tool)",
  mcp_windows: "windows MCP server (Screenshot, Click, Type, Wait, PowerShell, Snapshot vb. ~12 tool)",
};

// Niyet tespiti — regex tabanli, hafif. Yanlis pozitif = tool acilir (zarar yok),
// yanlis negatif = tool kapali (model "ihtiyacim var" derse load_toolset cagirir).
const RX_SSH = /\b(ssh|sunucu|sunucular|deploy|canliya|hetzner|volpora|pm2|nginx|server|certbot|apache|systemctl|srv\d+|interbim|domainhizmetleri)\b/i;
const RX_VAULT = /\b(vault|kasa|şifre|sifre|secret|api[\s-]?key|token sakla|sakla.*token)\b/i;
const RX_PLUGIN = /\b(plugin|eklenti|skill yükle|skill yukle|load_plugin|load_skill)\b/i;
const RX_MCP_MGMT = /\b(mcp.*(ekle|sunucu|bagla)|add_mcp|mcp_server)\b/i;
// Esnek: "uzmanlari olustur", "yeni ajan", "specialist olustur" gibi turevleri
// de yakalar. Onceki dar regex "uzmanlari olustur" eslesmiyor → load_toolset
// + ekstra tur gerekiyordu (UX kotu).
const RX_AGENT_NEW = /\b(uzman\w*\s+(olustur|oluştur|kur|yarat|ekle|create)|olustur\w*\s+uzman|kur\w*\s+uzman|yeni\s+uzman|yeni\s+ajan|create_agent|import_agent|export_agent|set_project_info|proje\s+bilgisi|specialist\s+(olustur|kur|create))\b/i;
const RX_IMAGE = /\b(resim|gorsel|görsel|image|illustration|chatgpt.login|chatgpt_login|generate_image)\b/i;
const RX_SECURITY = /\b(guvenlik|güvenlik|security|tarama.*url|url.*tarama|scan|csp|hsts|cors|fingerprint)\b/i;
const RX_UI = /\b(rebuild_ui|ui.*build|tauri|svelte.*build|frontend.*derle)\b/i;
// M5: SYSTEM tool'lari (restart_self, report_to_mimar, call_remote_agent,
// request_from_peer) artik niyet-bazli. Mimar default kumesinde her zaman
// ACIK degil — context tasarrufu. Sef "yeniden baslat" / "raporla" / "uzak"
// derken regex acar; tek seferlik isler icin yeterli.
const RX_SYSTEM = /\b(restart|yeniden\s+baslat|yeniden\s+başlat|rebuild|report.*mimar|call_remote|uzak\s+ajan|peer.*request|request.*peer)\b/i;
// DIAG: log/rapor/hata teshisi, model degistirme, template listesi.
const RX_DIAG = /\b(log|loglar|rapor|hata|debug|teşhis|teshis|analiz|tool.*kullan|kullan.*tool|model.*değiştir|model.*degistir|effort|template|sablon|şablon|audit)\b/i;
const RX_CODEGRAPH = /\b(code_search|code_node|code_callers|code_callees|code_impact|code_imports|code_files|code_stats|fonksiyon.*nerede|nerede.*tanimli|kim.*cagiriyor|caller|callee|qualified.?name|kod.*grafı|kod.*grafi|codegraph)\b/i;

export interface ToolGroupOpts {
  prompt: string;
  isGlobal: boolean; // Mimar mi proje sefi mi
  extraGroups?: readonly string[]; // load_toolset ile acilan ek gruplar
}

export function buildDisallowedTools({
  prompt,
  isGlobal,
  extraGroups = [],
}: ToolGroupOpts): string[] {
  const keep = new Set<string>(CORE);
  GIT.forEach((t) => keep.add(t)); // git her zaman
  // Proje seflerine bile temel not duzenleme acik kalsin.
  keep.add("note_update");
  keep.add("note_delete");

  // M6: for the Architect (isGlobal) the critical 3 groups are ALWAYS enabled —
  // they must not get caught by the intent regex, especially because a Turkish
  // character (REBUİLD vs rebuild) may not match, so when the user says "rebuild
  // ui yap" the tool must not be rejected.
  //  - UI: rebuild_ui (Tauri build — the Architect needs it constantly)
  //  - SYSTEM: restart_self/report/peer (Architect authority)
  // Toplam yuk ~2k token; izin engeline tercih edilir.
  if (isGlobal) {
    UI.forEach((t) => keep.add(t));
    SYSTEM.forEach((t) => keep.add(t));
  }

  // Niyet bazli ek gruplar.
  if (RX_AGENT_NEW.test(prompt)) AGENT_MGMT.forEach((t) => keep.add(t));
  if (RX_SSH.test(prompt)) SSH.forEach((t) => keep.add(t));
  if (RX_VAULT.test(prompt)) VAULT.forEach((t) => keep.add(t));
  if (RX_PLUGIN.test(prompt)) PLUGIN.forEach((t) => keep.add(t));
  if (RX_MCP_MGMT.test(prompt)) MCP_MGMT.forEach((t) => keep.add(t));
  if (RX_IMAGE.test(prompt)) IMAGE.forEach((t) => keep.add(t));
  if (RX_SECURITY.test(prompt)) SECURITY.forEach((t) => keep.add(t));
  if (RX_UI.test(prompt)) UI.forEach((t) => keep.add(t));
  if (RX_SYSTEM.test(prompt)) SYSTEM.forEach((t) => keep.add(t));
  if (RX_DIAG.test(prompt)) DIAG.forEach((t) => keep.add(t));
  // RX_CODEGRAPH artik no-op — CODEGRAPH tool'lari CORE'da, regex'e gerek yok.
  void RX_CODEGRAPH;

  // load_toolset ile manuel acilan gruplar.
  for (const g of extraGroups) {
    const tools = GROUP_MAP[g];
    if (tools) tools.forEach((t) => keep.add(t));
  }

  const disallowed = ALL_MCP.filter((t) => !keep.has(t)).map((t) => MCP_PREFIX + t);
  return disallowed;
}

// Debug yardimcisi — log icin.
export function summarizeGroups(disallowed: string[]): { kept: number; dropped: number } {
  return { kept: ALL_MCP.length - disallowed.length, dropped: disallowed.length };
}

// P1.1 (cache prefix stability): Intent regex'ler KALDIRILDI. Her prompt'ta
// degisen tool seti `tools` cache prefix'ini Anthropic'te invalidate ediyordu
// (1 token tool diff = komple prefix yeniden yazilir, ~6-15k cacheCreate /
// turn). Cozum: STABLE tool seti — CORE + GIT + (isGlobal ? UI/SYSTEM/
// MEMORY_WRITE/AGENT_MGMT/DIAG : kucuk set) + extraGroups (load_toolset ile
// persisted, manuel ac/kapa).
//
// Trade-off: Sef "ssh ile deploy yap" derken SSH tool'lari otomatik acilmaz;
// `load_toolset ssh` cagirmali. Bu cache hit kazancina degiyor (her turn
// ~$0.04 -> ~$0.005). Mimar varsayilanda buyuk pakete sahip oldugu icin
// gunluk kullanimda regex kaybi cogu durumda hissedilmez.
export function buildAllowedToolNames({
  prompt,
  isGlobal,
  extraGroups = [],
}: ToolGroupOpts): Set<string> {
  void prompt; // prompt artik tool seti etkilemiyor — cache stability
  const keep = new Set<string>(CORE);
  GIT.forEach((t) => keep.add(t));
  keep.add("note_update");
  keep.add("note_delete");
  if (isGlobal) {
    // Fix 69: Mimar default kumesi diet edildi. UI/SYSTEM surekli ihtiyac
    // (rebuild_ui, restart_self). AGENT_MGMT/DIAG niyet-bazli load_toolset ile.
    // MEMORY_WRITE kaldirildi (memory araclari komple cikarildi — kullanici talebi).
    UI.forEach((t) => keep.add(t));
    SYSTEM.forEach((t) => keep.add(t));
  }
  for (const g of extraGroups) {
    const tools = GROUP_MAP[g];
    if (tools) tools.forEach((t) => keep.add(t));
  }
  return keep;
}

export const ALL_GROUPS: readonly string[] = Object.keys(GROUP_MAP);
