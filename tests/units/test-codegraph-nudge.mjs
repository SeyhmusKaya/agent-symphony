// F6: CodeGraph nudge regex — Bash grep/find on code-extension files
// triggers a hint message (no hard block).

// This test checks sdkHooks' CODEGRAPH_NUDGE_RX at the regex level.
// It verifies pattern correctness rather than the hook's deep internals.

const RX = /\b(grep|rg|ag|find)\b[^|]*\.(ts|tsx|js|jsx|mjs|cjs|mts|cts|svelte|py|go|rs|java|c|cpp|h|hpp|cs|rb|php)\b/i;

const cases = [
  // [bash command, should match, label]
  ["grep -r foo src/**/*.ts", true, "grep + .ts files"],
  ["rg pattern --type ts", false, "rg + --type (no file ext literal)"],
  ["find . -name '*.svelte'", true, "find .svelte"],
  ["grep bar lib/foo.js", true, "grep + .js literal"],
  ["ls -la", false, "plain ls"],
  ["grep foo logs.txt", false, "grep + .txt (not code)"],
  ["grep foo | wc -l", false, "piped (excluded — | char)"],
  ["find /tmp -name '*.log'", false, "find + .log not code"],
  ["rg className styles.css", false, "rg + .css not in code list"],
  ["grep -rn class src/component.tsx", true, "grep + .tsx"],
  ["find src -name '*.py'", true, "find + .py"],
];

let pass = 0, fail = 0;
for (const [cmd, shouldMatch, label] of cases) {
  const matches = RX.test(cmd);
  if (matches === shouldMatch) {
    console.log(`PASS  ${label}: "${cmd}" -> ${matches}`);
    pass++;
  } else {
    console.log(`FAIL  ${label}: "${cmd}" -> ${matches} (expected: ${shouldMatch})`);
    fail++;
  }
}
console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
