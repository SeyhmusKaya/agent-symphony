// Fix 104: model slug cleanup + opus [1m] alias.
// toApiModel: '-fast'/'[fast]' are stripped; '[1m]' is added for opus;
// '[1m]' is stripped for sonnet/haiku.

import { toApiModel } from "../../dist/orchestrator/sdkAgents.js";

const cases = [
  // [input, expected, label]
  ["claude-opus-4-8", "claude-opus-4-8[1m]", "opus always 1m"],
  ["claude-opus-4-8[1m]", "claude-opus-4-8[1m]", "opus 1m preserved"],
  ["claude-opus-4-8-fast[1m]", "claude-opus-4-8[1m]", "fast strip + 1m kept"],
  ["claude-opus-4-8-fast", "claude-opus-4-8[1m]", "fast strip + 1m added"],
  ["claude-opus-4-8[fast]", "claude-opus-4-8[1m]", "[fast] strip + 1m added"],
  ["claude-opus-4-7", "claude-opus-4-7[1m]", "opus 4.7 always 1m"],
  ["claude-sonnet-4-6", "claude-sonnet-4-6", "sonnet 200k (no 1m)"],
  ["claude-sonnet-4-6[1m]", "claude-sonnet-4-6", "sonnet [1m] strip"],
  ["claude-haiku-4-5", "claude-haiku-4-5", "haiku 200k"],
];

let pass = 0, fail = 0;
for (const [input, expected, label] of cases) {
  const actual = toApiModel(input);
  if (actual === expected) {
    console.log(`PASS  ${label}: "${input}" -> "${actual}"`);
    pass++;
  } else {
    console.log(`FAIL  ${label}: "${input}" -> "${actual}" (expected: "${expected}")`);
    fail++;
  }
}
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
