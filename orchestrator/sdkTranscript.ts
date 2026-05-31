// orchestrator/sdkTranscript.ts — SDK message content -> transcript helper.
// F1.3b: specialist.ts kaldirildiginda task.ts ve worker.ts hala bu kucuk
// fonksiyona ihtiyac duydugu icin ayri modul olarak tasindi. Semantik
// degismez — text bloklarini birlestir, tool_use bloklarini "[arac: ...]"
// etiketi ile isaretle.

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
}

export function extractTranscript(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === "text" && block.text) parts.push(block.text);
    else if (block.type === "tool_use" && block.name) parts.push(`[arac: ${block.name}]`);
  }
  return parts.join("\n");
}
