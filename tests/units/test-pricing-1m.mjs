// Fix 104: pricing is1m fallback opus -> auto true.

import { priceForModel } from "../../dist/orchestrator/pricing.js";

const cases = [
  // [model, totalContext, expectedInputRate, label]
  ["claude-opus-4-8", 50_000, 15, "opus + 50k context = 200k tier (input $15)"],
  ["claude-opus-4-8", 250_000, 30, "opus + 250k context = 1m tier (input $30)"],
  ["claude-sonnet-4-6", 50_000, 3, "sonnet 200k tier (input $3)"],
  ["claude-sonnet-4-6", 250_000, 3, "sonnet stays 200k tier even if forced to 1m"],
  ["claude-haiku-4-5", 50_000, 1, "haiku flat $1"],
];

let pass = 0, fail = 0;
for (const [model, ctx, expectedInput, label] of cases) {
  const price = priceForModel(model, { totalContext: ctx });
  if (price.input === expectedInput) {
    console.log(`PASS  ${label}: input=$${price.input}/M`);
    pass++;
  } else {
    console.log(`FAIL  ${label}: input=$${price.input}/M (expected: $${expectedInput}/M)`);
    fail++;
  }
}
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
