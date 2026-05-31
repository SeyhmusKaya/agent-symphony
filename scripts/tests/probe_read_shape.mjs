// Measure in what SHAPE the Read tool_response arrives at the PostToolUse hook.
// Why compressAny cannot intercept Read — confirm the shape mismatch.
import { query } from "@anthropic-ai/claude-agent-sdk";

const target = "orchestrator/chief/runChiefAttempt.ts"; // large code file
let captured = null;

const hooks = {
  PostToolUse: [
    {
      hooks: [
        async (input) => {
          const h = input;
          if (h.tool_name === "Read" && !captured) {
            const tr = h.tool_response;
            captured = {
              typeof: typeof tr,
              isArray: Array.isArray(tr),
              keys: tr && typeof tr === "object" && !Array.isArray(tr) ? Object.keys(tr) : null,
              arrItem0: Array.isArray(tr) && tr[0] ? { keys: Object.keys(tr[0]), typeofText: typeof tr[0].text, typeofContent: typeof tr[0].content } : null,
              preview: JSON.stringify(tr).slice(0, 300),
            };
            console.log("=== READ tool_response SHAPE ===");
            console.log(JSON.stringify(captured, null, 2));
          }
          return { continue: true };
        },
      ],
    },
  ],
};

const it = query({
  prompt: `Read the first 50 lines of ${target} then say "done".`,
  options: {
    model: "claude-haiku-4-5",
    cwd: "C:\\Users\\seyh\\Desktop\\projeler\\Architect",
    allowedTools: ["Read"],
    hooks,
    maxTurns: 3,
  },
});
for await (const m of it) {
  if (m.type === "result") break;
}
if (!captured) console.log("Read was not called/captured.");
process.exit(0);
