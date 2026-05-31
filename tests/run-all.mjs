// Runs all sandbox-compatible tests in order (unit + boot integration).
// Live API tests (test-live-*.mjs) are host-dependent — NOT INCLUDED in this runner.
// Usage: npm run build && node tests/run-all.mjs

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const suites = [
  ["unit  ", "units/test-model-slug.mjs"],
  ["unit  ", "units/test-pricing-1m.mjs"],
  ["unit  ", "units/test-codegraph-nudge.mjs"],
  ["unit  ", "units/test-skills.mjs"],
  ["unit  ", "units/test-budget.mjs"],
  ["unit  ", "units/test-memory-scope.mjs"],
  ["unit  ", "units/test-autonomous.mjs"],
  ["integ ", "integration/test-startup.mjs"],
];

let suitePass = 0, suiteFail = 0;
const failed = [];
for (const [kind, rel] of suites) {
  const p = join(here, rel);
  process.stdout.write(`\n### [${kind}] ${rel}\n`);
  const r = spawnSync("node", [p], { cwd: join(here, ".."), stdio: "inherit" });
  if (r.status === 0) suitePass++;
  else { suiteFail++; failed.push(rel); }
}

console.log(`\n========================================`);
console.log(`SUITES: ${suitePass} pass / ${suiteFail} fail`);
if (failed.length) console.log("FAILED: " + failed.join(", "));
console.log(`========================================`);
process.exit(suiteFail === 0 ? 0 : 1);
