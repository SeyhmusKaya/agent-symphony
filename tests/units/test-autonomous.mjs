// F3: AutonomousManager — startJob, attach, checkpoint, pause/resume/cancel,
// failure escalation, maxDays cap rejection.

import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "arc-auto-test-"));
const { AutonomousManager } = await import("../../dist/orchestrator/autonomousMode.js");

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.log(`FAIL  ${label}`); fail++; }
}

// Mock notifier + emit + attach.
const notified = [];
const notifier = { send: async (n) => { notified.push(n); }, sendNotification: async (n) => { notified.push(n); } };
const emitted = [];
const emit = (kind, payload) => emitted.push({ kind, payload });

const enqueued = [];
const commits = [];
const chatMsgs = [];
let dirty = 0;
const attach = {
  enqueueAutonomousTurn: (text, jobId) => enqueued.push({ text, jobId }),
  gitCommit: (msg) => { commits.push(msg); return { committed: true, hash: "abc1234" }; },
  countDirtyFiles: () => dirty,
  appendChatMessage: (text) => chatMsgs.push(text),
  pushStatus: () => {},
};

const mgr = new AutonomousManager({
  appDataDir: tmp,
  sefProjectId: "TestProje",
  emit,
  notifier,
});
mgr.attach(attach);

// startJob
const { jobId, job } = mgr.startJob({ task: "Rewrite the checkout page from scratch", maxDays: 3 });
check("startJob returns jobId", typeof jobId === "string" && jobId.length > 0);
check("job status running", job.status === "running");
check("first autonomous turn enqueued", enqueued.length === 1);
check("enqueue jobId matches", enqueued[0].jobId === jobId);

// maxDays cap rejection
let capRejected = false;
try { mgr.startJob({ task: "x", maxDays: 99 }); } catch { capRejected = true; }
check("maxDays > cap rejected", capRejected);

// empty task rejection
let emptyRejected = false;
try { mgr.startJob({ task: "  ", maxDays: 1 }); } catch { emptyRejected = true; }
check("empty task rejected", emptyRejected);

// checkpoint — turnsTotal bump + cost
await mgr.onTurnCheckpoint(jobId, 1.25);
const j1 = mgr.getJob(jobId);
check("checkpoint turnsTotal=1", j1.turnsTotal === 1);
check("checkpoint costUsdTotal=1.25", Math.abs(j1.costUsdTotal - 1.25) < 0.001);
check("checkpoint consecutiveFailures=0", j1.consecutiveFailures === 0);

// 5+ dirty files → triggers auto-commit
dirty = 6;
await mgr.onTurnCheckpoint(jobId, 0.5);
check("5+ files triggered auto-commit", commits.length >= 1);

// pause
const jp = mgr.pauseJob(jobId);
check("pauseJob status paused", jp.status === "paused");
// pause'dayken checkpoint no-op
const turnsBefore = mgr.getJob(jobId).turnsTotal;
await mgr.onTurnCheckpoint(jobId, 1);
check("paused checkpoint no-op", mgr.getJob(jobId).turnsTotal === turnsBefore);

// resume
const jr = mgr.resumeJob(jobId);
check("resumeJob status running", jr.status === "running");

// failure escalation — 3 consecutive fails = failed
await mgr.onTurnFailure(jobId, "error1");
await mgr.onTurnFailure(jobId, "error2");
await mgr.onTurnFailure(jobId, "error3");
const jf = mgr.getJob(jobId);
check("3 consecutive fails = failed", jf.status === "failed");
check("failReason set", typeof jf.failReason === "string" && jf.failReason.length > 0);

// cancel (new job)
const { jobId: jid2 } = mgr.startJob({ task: "second job", maxDays: 1 });
const jc = mgr.cancelJob(jid2);
check("cancelJob status cancelled", jc.status === "cancelled");

// listJobs
check("listJobs >= 2", mgr.listJobs().length >= 2);

mgr.dispose();
try { rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
