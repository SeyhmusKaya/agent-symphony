// orchestrator/tools.ts — SHIM (orchestrator/tools/ paketine re-export).
// Eski 2010 satirlik dosya 14 kategori modulune bolundu (bkz docs/plan-buyuk-
// dosya-parcalama.md). Bu shim sayesinde `import { buildChiefTools, type
// EmitFn, type ToolContext } from "./tools.js"` kullanan eski importer'lar
// (orchestrator/main.ts, prompts.ts, advisorChief.ts, vd.) kirilmaz.
//
// TODO: tum import'lar "./tools/index.js" veya "./tools/types.js"e gecince
// bu dosyayi sil.

export { buildChiefTools } from "./tools/index.js";
export type { EmitFn, ToolContext } from "./tools/types.js";
