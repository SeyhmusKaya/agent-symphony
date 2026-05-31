// orchestrator/tools/vaultTools.ts — secrets vault.
// vault_set / vault_get / vault_list / vault_delete.

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Vault } from "../vault.js";
import { type ToolContext, ok, fail } from "./types.js";

export function buildVaultTools(_ctx: ToolContext) {
  const vault = new Vault();

  const vaultSet = tool(
    "vault_set",
    "Saves a secret (password/key/token) to the vault. The vault is outside the repo.",
    { anahtar: z.string(), deger: z.string() },
    async (args) => {
      vault.set(args.anahtar, args.deger);
      return ok(`Saved to vault: ${args.anahtar}`);
    },
  );

  const vaultGet = tool(
    "vault_get",
    "Gets a secret from the vault.",
    { anahtar: z.string() },
    async (args) => {
      const v = vault.get(args.anahtar);
      return v === undefined ? fail(`Not in vault: ${args.anahtar}`) : ok(v);
    },
  );

  const vaultList = tool(
    "vault_list",
    "Lists all key names in the vault (does not show values).",
    {},
    async () => {
      const keys = vault.keys();
      return ok(keys.length ? keys.join("\n") : "Vault is empty.");
    },
  );

  const vaultDelete = tool(
    "vault_delete",
    "Deletes a secret from the vault.",
    { anahtar: z.string() },
    async (args) => {
      return vault.delete(args.anahtar)
        ? ok(`Deleted: ${args.anahtar}`)
        : fail(`Not in vault: ${args.anahtar}`);
    },
  );

  return [vaultSet, vaultGet, vaultList, vaultDelete];
}
