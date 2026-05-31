// F4: BudgetManager — recordSpend + daily total + fallback trigger.

import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "arc-budget-test-"));
const persistFile = join(tmp, "budgets.json");

const { BudgetManager, FALLBACK_CHEAPER_MODEL } = await import(
  "../../dist/orchestrator/budgetManager.js"
);

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`PASS  ${label}`); pass++; }
  else { console.log(`FAIL  ${label}`); fail++; }
}

const bm = new BudgetManager(
  {
    perAgentDailyUsd: 5,
    perChiefDailyUsd: 20,
    perMimarDailyUsd: 50,
    hourlyBurnAlarmUsd: 10,
    fallbackThresholdPct: 0.8,
  },
  persistFile,
);

// Initial state
const reportEmpty = bm.getReport();
check("initial report is array", Array.isArray(reportEmpty.topSpenders));
check("initial topSpenders = 0", reportEmpty.topSpenders.length === 0);

// Record some spend
bm.recordSpend("VolporaSef", "chief", 5);
bm.recordSpend("VolporaSef", "chief", 10);
const total = bm.getDailyTotal("VolporaSef", "chief");
check("daily total = 15", total.usd === 15);
check("cap = 20", total.capUsd === 20);
check("pct = 0.75", Math.abs(total.pctUsed - 0.75) < 0.001);
check("not exceeded", total.exceeded === false);
check("not at warning (0.75 < 0.8 threshold)", total.atWarning === false);

// Hit fallback threshold
bm.recordSpend("VolporaSef", "chief", 2); // total 17 = 85%
const total2 = bm.getDailyTotal("VolporaSef", "chief");
check("daily total = 17", total2.usd === 17);
check("pct = 0.85", Math.abs(total2.pctUsed - 0.85) < 0.001);

const fb = bm.shouldFallbackToCheaperModel("VolporaSef", "chief", "claude-opus-4-8");
check("fallback triggered (opus + 85%)", fb === true);

const fbSonnet = bm.shouldFallbackToCheaperModel("VolporaSef", "chief", "claude-sonnet-4-6");
check("no fallback for sonnet (already cheap)", fbSonnet === false);

check("FALLBACK constant = claude-sonnet-4-6", FALLBACK_CHEAPER_MODEL === "claude-sonnet-4-6");

// Report
const report = bm.getReport();
check("report topSpenders.length = 1", report.topSpenders.length === 1);
check("report top.agent = VolporaSef", report.topSpenders[0].agent === "VolporaSef");
check("report top.usd = 17", report.topSpenders[0].usd === 17);

// Cleanup
try { rmSync(tmp, { recursive: true, force: true }); } catch {}

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
