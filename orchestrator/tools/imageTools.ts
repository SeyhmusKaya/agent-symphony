// orchestrator/tools/imageTools.ts — image generation via ChatGPT Plus.
// generate_image / chatgpt_login. Uses Playwright (there is no Anthropic native image
// generation API for image generation — the current path is the Plus session).

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { generateImage, ensureChatGPTLogin } from "../imageGen.js";
import { type ToolContext, ok, fail } from "./types.js";

export function buildImageTools(ctx: ToolContext) {
  const { emit } = ctx;

  const uretResim = tool(
    "generate_image",
    "Generates an image via ChatGPT Plus. aciklama must be in English + detailed. First use requires chatgpt_login.",
    {
      aciklama: z.string(),
      en: z.number().optional(),
      boy: z.number().optional(),
      seed: z.number().optional(),
    },
    async (args) => {
      try {
        emit("resim_uretiliyor", { aciklama: args.aciklama });
        const img = await generateImage(args.aciklama, {
          width: args.en,
          height: args.boy,
          seed: args.seed,
        });
        emit("resim_uretildi", {
          aciklama: args.aciklama,
          mediaType: img.mediaType,
        });
        return {
          content: [
            {
              type: "image" as const,
              data: img.base64,
              mimeType: img.mediaType,
            },
            {
              type: "text" as const,
              text: `[Generated with ChatGPT Plus: ${args.aciklama}]`,
            },
          ],
        };
      } catch (e) {
        const mesaj = (e as Error).message ?? "unknown";
        emit("hata", { agent: "generate_image", mesaj });
        return fail(`Could not generate image: ${mesaj}`);
      }
    },
  );

  const chatgptLogin = tool(
    "chatgpt_login",
    "Opens a visible browser for ChatGPT Plus; the user logs in, the session is stored persistently. One-time.",
    {},
    async () => {
      try {
        emit("chatgpt_login_basladi", {});
        const r = await ensureChatGPTLogin();
        emit("chatgpt_login_bitti", { ok: r.ok, mesaj: r.mesaj });
        if (!r.ok) return fail(r.mesaj);
        return {
          content: [{ type: "text" as const, text: r.mesaj }],
        };
      } catch (e) {
        return fail(`ChatGPT login error: ${(e as Error).message}`);
      }
    },
  );

  return [uretResim, chatgptLogin];
}
