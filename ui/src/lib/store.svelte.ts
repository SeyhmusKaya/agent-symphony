// ui/src/lib/store.svelte.ts — SHIM (re-export to the ui/src/lib/store/ package).
// The old 1710-line file was split up (see docs/plan-buyuk-dosya-parcalama.md):
//   - store/types.ts            : pure data types
//   - store/serverMessages.ts   : WS protocol ServerMessage union
//   - store/specialistLive.ts   : Fix 88 SpecialistLive
//   - store/pending.ts          : Fix 101 localStorage helpers
//   - store/watchdog.ts         : Fix 91+103 timer logic
//   - store/projectSession.svelte.ts : ProjectSession class
//   - store/index.ts            : aggregator
//
// Thanks to this shim, old Svelte components using
// `import { ProjectSession, type ChatMessage, ... } from "./store.svelte"` are not broken.
//
// TODO: delete this file once all imports move to "./store/index.js".

export type {
  AgentInfo,
  AgentStatus,
  AgentView,
  AjanSoru,
  Attachment,
  AutoRollbackInfo,
  CanliAktivite,
  ChatMessage,
  ChatSegment,
  ControlAction,
  CostBreakdown,
  DiffEntry,
  FeedEvent,
  ProjectStatus,
  QueueItem,
  ServerMessage,
  SessionInfo,
  ToolActivity,
  WorkerView,
  HelperView,
} from "./store/index.js";
export { ProjectSession } from "./store/index.js";
