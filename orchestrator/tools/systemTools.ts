// orchestrator/tools/systemTools.ts — system-level tools.
// ask_user_choice / restart_self / rebuild_ui / load_toolset / unload_toolset.
// This file also carries the rebuild_ui-specific helpers:
//   - askCache + askInflight (ask_user_choice dedupe + in-flight guard)
//   - checkAgentBusy (M6: status query of the neighbors' orchestrators)
//   - pauseChiefOnce + preCompactAllChiefs (Fix 94: pre-pause before rebuild)

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import WebSocket from "ws";
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, appDataDir } from "../fleet.js";
import { ALL_GROUPS } from "../toolGroups.js";
import { type ToolContext, type EmitFn, ok, fail } from "./types.js";

// P1.4: ask_user_choice dedupe — keeps the last asked question and its answer per-projectId
// in a 90s window. If the model asks the same question+options combination again the cached
// answer is returned (the new question is not shown to the USER). So the architect does not
// loop on a "multiple-choice question" and ask the user twice.
interface AskCacheEntry {
  answer: string;
  ts: number;
}
const askCache = new Map<string, AskCacheEntry>();
const ASK_DEDUPE_WINDOW_MS = 90_000;
function askCacheKey(projectId: string, soru: string, secenekler: string[]): string {
  return `${projectId}::${soru.trim().toLowerCase()}::${[...secenekler].sort().join("|").toLowerCase()}`;
}

// Fix DUP-QCARD: in-flight guard — if the model emits the same ask_user_choice 2+ times via
// parallel tool_use in the SAME assistant turn (Claude 4.7 batch behavior) askUser is called
// twice, 2 cards drop into the UI, the user picks one answer but there are 2 tool_results ->
// 2 responses. Solution: a pending Promise is held for the first call per key; the later ones
// await the same Promise. When the result comes they all get the same answer, the UI shows a
// single card, the model a single coherent chain.
const askInflight = new Map<string, Promise<string>>();

// M6: rebuild_ui guard — sends durum_iste over WS to the neighbor's orchestrator, reads the
// busy flag. 1.2s timeout; an agent it cannot reach is NOT counted as busy (returns false).
// Called in parallel with Promise.all inside rebuild_ui.
function checkAgentBusy(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    const finish = (busy: boolean) => {
      if (settled) return;
      settled = true;
      try { ws?.close(); } catch { /* ignore */ }
      resolve(busy);
    };
    try {
      ws = new WebSocket(`ws://localhost:${port}`);
    } catch {
      return resolve(false);
    }
    ws.on("open", () => {
      try { ws!.send(JSON.stringify({ kind: "durum_iste" })); } catch {}
    });
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.kind === "durum" && m.payload) {
          finish(!!m.payload.busy);
        }
      } catch {}
    });
    ws.on("error", () => finish(false));
    setTimeout(() => finish(false), 1200);
  });
}

// Fix 94: before rebuild, write the needsContextPrepend flag to each active chief's
// SessionStore. The `kontrol:duraklat` message triggers the Fix 95 pause branch → the flag +
// last turn fragment are written to state.json. After the process dies the new process reads
// this state.json and applies the prepend on the first user message. Wait 1500ms per chief
// (WS round-trip + disk write). ~10s extra in total.
function pauseChiefOnce(port: number, _projectName: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      try { ws?.close(); } catch { /* ignore */ }
      resolve(ok);
    };
    try {
      ws = new WebSocket(`ws://localhost:${port}`);
    } catch {
      return finish(false);
    }
    ws.on("open", () => {
      try {
        ws!.send(JSON.stringify({ kind: "kontrol", aksiyon: "duraklat" }));
        // Wait 1.5s — enough time for the backend to add pauseSids + setNeedsContextPrependFor
        // + persist (write state.json). Then close.
        setTimeout(() => finish(true), 1500);
      } catch {
        finish(false);
      }
    });
    ws.on("error", () => finish(false));
    setTimeout(() => finish(false), 3000);
  });
}

async function preCompactAllChiefs(
  entries: Array<{ port: number; pid: number; name: string }>,
  selfPid: number,
): Promise<void> {
  const others = entries.filter((e) => e.pid !== selfPid);
  if (others.length === 0) {
    console.log("[fix94 precompact] no other active chief, skipped");
    return;
  }
  console.log(
    `[fix94 precompact] sending pause to ${others.length} chiefs: ${others.map((e) => e.name).join(", ")}`,
  );
  const results = await Promise.all(
    others.map(async (e) => {
      const ok = await pauseChiefOnce(e.port, e.name);
      return { name: e.name, port: e.port, ok };
    }),
  );
  console.log(`[fix94 precompact] result: ${JSON.stringify(results)}`);
}

// The supervised-restart core — the restart_self tool AND the restart_iste WS message the
// architect sends via restart_agent (main.ts handler) share the same mechanism. Write
// pending-update.json, read last-good, spawn the supervisor child, self exit after 1.5s. If
// the supervisor cannot bring it up in 45s it rolls back to the last-good version.
export interface ControlledRestartOpts {
  port: number;
  emit: EmitFn;
  not?: string;
  devamGorevi?: string;
  kontrolNotu?: string;
  kontrolNotuId?: string;
}

export function spawnControlledRestart(opts: ControlledRestartOpts): void {
  const { port, emit } = opts;
  const repo = repoRoot();
  try {
    writeFileSync(
      join(appDataDir(), "pending-update.json"),
      JSON.stringify({
        ts: Date.now(),
        not: opts.not ?? "",
        devamGorevi: opts.devamGorevi ?? "",
        kontrolNotu: opts.kontrolNotu ?? "",
        kontrolNotuId: opts.kontrolNotuId ?? "",
      }),
      "utf8",
    );
  } catch {
    /* ignore */
  }
  let lastGood = "none";
  try {
    const lg = readFileSync(join(appDataDir(), "last-good.txt"), "utf8").trim();
    if (lg) lastGood = lg;
  } catch {
    /* ignore */
  }
  const supervisor = join(repo, "orchestrator", "supervisor.js");
  // childArgs = node flags (execArgv) + script + script-args (argv[1..]).
  // CRITICAL: the orchestrator entry is a .ts file — WITHOUT the tsx loader `node main.ts`
  // cannot be parsed and the child crashes instantly (the supervisor waits 45s and falls to
  // rollback, the agent does not come back). If the tsx loader is in neither execArgv nor
  // NODE_OPTIONS (e.g. the parent was started differently) force-add it — for restart_self +
  // restart_agent reliability. If tsx is already loaded do not double-add.
  const entryIsTs = (process.argv[1] ?? "").endsWith(".ts");
  const hasTsxLoader =
    process.execArgv.some((a) => /tsx/.test(a)) ||
    /tsx/.test(process.env.NODE_OPTIONS ?? "");
  const loaderArgs = entryIsTs && !hasTsxLoader ? ["--import", "tsx"] : [];
  const childArgs = [...loaderArgs, ...process.execArgv, ...process.argv.slice(1)];
  spawn(
    process.execPath,
    [supervisor, String(port), repo, lastGood, process.execPath, JSON.stringify(childArgs)],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      // pass env explicitly — so NODE_OPTIONS (tsx loader etc.) propagates to the child via
      // the supervisor.
      env: process.env,
    },
  ).unref();
  emit("ajan_durum_degisti", { agent: "sef", durum: "yeniden_baslatiliyor" });
  // 1500ms — give time for graceful shutdown (saveContext/saveChatLog/interrupt).
  setTimeout(() => process.exit(0), 1500);
}

export function buildSystemTools(ctx: ToolContext) {
  const {
    askUser,
    fleet,
    projectId,
    projectName,
    notes,
    emit,
    port,
    requestToolset,
    requestToolsetContinue,
    unloadToolset,
    listLoadedToolsets,
  } = ctx;

  const askUserChoice = tool(
    "ask_user_choice",
    "Asks the user an inline multiple-choice question; a card drops into the chat, the choice returns as text. Use this instead of plain text for a decision/approval.",
    {
      soru: z.string(),
      secenekler: z.array(z.string()).min(2).max(8),
      cokluSecim: z.boolean().optional(),
      serbestMetin: z.boolean().optional(),
    },
    async (args) => {
      if (!askUser) {
        return fail(
          "ask_user_choice cannot be used in this context — ask the user with plain text.",
        );
      }
      // P1.4: dedupe — if the model asks the same question/options again within 90s, do not
      // overwhelm the user, return the cached answer.
      const key = askCacheKey(projectId, args.soru, args.secenekler);
      const cached = askCache.get(key);
      if (cached && Date.now() - cached.ts < ASK_DEDUPE_WINDOW_MS) {
        return ok(
          `YOU ALREADY ASKED — the user picked "${cached.answer}". Do not ask again, proceed directly to implementation.`,
        );
      }
      // Fix DUP-QCARD: if 2+ identical ask_user_choice tool_use's arrive at the same time
      // (parallel batch), bind the second to the same in-flight Promise — askUser is called
      // only ONCE, only ONE UI card is created, when the user picks, the same answer is
      // reflected to both tool_results, the model does not produce 2 responses.
      let pending = askInflight.get(key);
      const isOwner = !pending;
      if (!pending) {
        pending = askUser(
          args.soru,
          args.secenekler,
          args.cokluSecim ?? false,
          args.serbestMetin ?? true,
        );
        askInflight.set(key, pending);
      }
      try {
        const cevap = await pending;
        const temiz = cevap.trim() || "(answer empty)";
        if (isOwner) {
          askCache.set(key, { answer: temiz, ts: Date.now() });
          askInflight.delete(key);
        }
        // P1.5: plain return text — the "echo on the FIRST line" guidance was removed (the
        // model could interpret it as a signal to ask a second time and prolong the loop). A
        // plain "selected → continue" is enough.
        return ok(`The user picked: "${temiz}". Proceed to implementation, do not ask again.`);
      } catch (e) {
        if (isOwner) askInflight.delete(key);
        return fail(
          `User question error: ${(e as Error).message ?? "unknown"}`,
        );
      }
    },
  );

  const restartSelf = tool(
    "restart_self",
    "Restarts the orchestrator process in a supervised way (rolls back to the last good version if it does not come up in 45s). devam_gorevi: the new process autonomously continues the user's unfinished task. kontrol_notu: a short note describing the changes made (file/commit/behavior) — written as a NOTE tagged 'tur:rebuild-kontrol', the new architect reads and verifies it with note_search. zorla=true starts even if other agents are busy (default: check + ask for approval).",
    {
      not: z.string().optional(),
      devam_gorevi: z.string().optional(),
      kontrol_notu: z.string().optional(),
      zorla: z.boolean().optional(),
    },
    async (args) => {
      // M-restart-guard: if zorla=false, are the other orchestrators busy? The architect +
      // other chiefs + advisors. If busy is found, approve via askUser.
      if (!args.zorla) {
        const others = fleet.list().filter((e) => e.projectId !== projectId);
        const busyAgents: string[] = [];
        await Promise.all(
          others.map(async (e) => {
            try {
              if (await checkAgentBusy(e.port)) busyAgents.push(e.name);
            } catch { /* ignore */ }
          }),
        );
        if (busyAgents.length > 0 && askUser) {
          const onay = await askUser(
            `Agent(s) currently running: ${busyAgents.join(", ")}. Should I restart_self? (it does NOT harm their own processes — they are independent — but there may be a temporary WS hiccup in the UI.)`,
            ["Yes, restart", "No, wait until I'm done"],
            false,
            false,
          );
          if (!onay.toLowerCase().startsWith("yes")) {
            return fail(`Restart cancelled (user decision). Active agents: ${busyAgents.join(", ")}`);
          }
        }
      }
      // If there is a control note, write it to a NOTE as 'tur:rebuild-kontrol' (the memory
      // tools were removed). The new architect reads + verifies + deletes it with note_search
      // in the post-update flow.
      const kontrolNotu = args.kontrol_notu?.trim() ?? "";
      let kontrolNotuId = "";
      if (kontrolNotu) {
        try {
          const n = notes.add({
            baslik: "Rebuild control note",
            icerik: kontrolNotu,
            kapsam: "genel",
            kapsamAd: "General",
            etiketler: ["tur:rebuild-kontrol", "tur:auto-restart"],
          });
          kontrolNotuId = n.id;
        } catch {
          /* ignore — writing the note is not critical */
        }
      }
      // Shared core — the architect's restart_agent -> restart_iste handler also calls the
      // same function. supervisor spawn + self exit after 1.5s.
      spawnControlledRestart({
        port,
        emit,
        not: args.not,
        devamGorevi: args.devam_gorevi,
        kontrolNotu,
        kontrolNotuId,
      });
      return ok(
        "Supervised restart started. If it breaks, it automatically reverts to the last good version.",
      );
    },
  );

  // Full UI rebuild + ui.exe relaunch. So the architect can update itself. Detached
  // PowerShell script: wait 2s, kill ui.exe, build, relaunch. Meanwhile the orchestrator
  // (parent) either dies or continues — the script is independent.
  const rebuildUi = tool(
    "rebuild_ui",
    "Builds the Tauri UI from scratch + refreshes ui.exe (3-5 min, the window closes). Use when UI/frontend code (svelte/css/tauri/Rust) changes. If only backend TS changed, restart_self is enough. zorla=true => rebuild even if another agent is running.",
    {
      kill_orchestrator: z.boolean().optional(),
      zorla: z.boolean().optional(),
    },
    async (args) => {
      try {
        const killOrch = args.kill_orchestrator !== false;
        // M6: block if other orchestrators have an active turn (unless zorla).
        if (!args.zorla) {
          const busyList: string[] = [];
          for (const e of fleet.list()) {
            if (e.pid === process.pid) continue;
            const busy = await checkAgentBusy(e.port).catch(() => false);
            if (busy) busyList.push(`${e.name} (pid ${e.pid})`);
          }
          if (busyList.length) {
            return fail(
              `rebuild_ui blocked — there are agents currently running an active turn: ${busyList.join(", ")}. ` +
                `Wait for them to finish or force with zorla=true.`,
            );
          }
        }
        const root = repoRoot();
        const uiDir = join(root, "ui");
        const exePath = join(uiDir, "src-tauri", "target", "release", "ui.exe");
        const logPath = join(appDataDir(), "logs", "rebuild_ui.log");
        const scriptPath = join(appDataDir(), "rebuild_ui.ps1");
        // Leave a marker so the new orchestrator triggers the postUpdatePrompt flow. Pending
        // tasks are scanned there too.
        try {
          writeFileSync(
            join(appDataDir(), "pending-update.json"),
            JSON.stringify({ ts: Date.now(), not: "UI rebuild" }),
            "utf8",
          );
        } catch {
          /* ignore */
        }
        // Fix 94: before rebuild, send `kontrol:duraklat` to all active chiefs. This triggers
        // the Fix 95 pause branch → needsContextPrepend=TRUE + recentTurnsFragment (raw text
        // of the last 3 turns) is written to each chief's SessionStore. After the process dies
        // the new process reads from state.json and applies the prepend on the first user
        // message → post-rebuild memory is NOT LOST. 1.5s ws wait per chief; ~10s extra total.
        await preCompactAllChiefs(fleet.list(), process.pid);
        // First let us fix the npm + node path — the spawn cwd PATH can be broken. Write the
        // PowerShell script to disk, redirect to a log. Even if the parent dies the detached
        // process continues.
        const orchKill = killOrch
          ? `Get-Process -Id ${process.pid} -EA SilentlyContinue | Stop-Process -Force`
          : "";
        const psLines = [
          `$ErrorActionPreference = 'Continue'`,
          `Start-Transcript -Path '${logPath.replace(/'/g, "''")}' -Force | Out-Null`,
          `Write-Host "=== rebuild_ui started $(Get-Date -Format 'HH:mm:ss') ==="`,
          `Start-Sleep -Seconds 2`,
          `Get-Process ui -EA SilentlyContinue | Stop-Process -Force; Start-Sleep -Seconds 2`,
          `Set-Location '${uiDir.replace(/'/g, "''")}'`,
          `Write-Host "cwd: $(Get-Location)"`,
          `Write-Host "npm: $(Get-Command npm | Select-Object -ExpandProperty Source)"`,
          `& cmd /c "npm run tauri build 2>&1"`,
          `$buildExit = $LASTEXITCODE`,
          `Write-Host "build exit code: $buildExit"`,
          `if ($buildExit -ne 0) { Write-Host 'BUILD FAILED'; Stop-Transcript | Out-Null; exit 1 }`,
          `Write-Host "starting ui.exe..."`,
          `Start-Process -FilePath '${exePath.replace(/'/g, "''")}'`,
          `Write-Host "done. killing orchestrator: ${killOrch}"`,
          orchKill,
          `Stop-Transcript | Out-Null`,
        ].filter(Boolean);
        const scriptContent = psLines.join("\n");
        writeFileSync(scriptPath, scriptContent, "utf8");
        // Windows TRULY-DETACHED launch:
        //   spawn("powershell.exe", {detached:true, stdio:"ignore"}).unref()
        //   is not enough — when the parent (orchestrator) dies 1.5s after restart_self the
        //   child also dies in a race condition (50+ rebuild attempts failed this way).
        //   Solution: wrap it with cmd.exe /c start /b /min "" powershell ... The Windows
        //   shell launcher starts the process fully detached from its own job; it survives
        //   even if the parent dies.
        const psExe = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
        const child = spawn(
          "cmd.exe",
          [
            "/c",
            "start",
            "/b",
            "/min",
            '""',
            psExe,
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
            scriptPath,
          ],
          {
            detached: true,
            stdio: "ignore",
            cwd: root,
            windowsHide: true,
            windowsVerbatimArguments: true,
          },
        );
        // Catch and record an ENOENT or similar error — so it does not fail silently.
        child.on("error", (e) => {
          emit("rebuild_spawn_hata", { mesaj: e.message });
          try {
            writeFileSync(
              join(appDataDir(), "logs", "rebuild_ui.log"),
              `SPAWN ERROR: ${e.message}\n`,
              "utf8",
            );
          } catch {}
        });
        child.unref();
        emit("rebuild_baslatildi", {
          pid: child.pid,
          killOrchestrator: killOrch,
          logPath,
          scriptPath,
        });
        return {
          content: [
            {
              type: "text" as const,
              text:
                `UI rebuild started via detached PowerShell (pid ${child.pid}). ` +
                `~3-5 min. ui.exe will close and reopen with the new one. ` +
                `Log: ${logPath}. Script: ${scriptPath}. ` +
                (killOrch
                  ? "This orchestrator dies too — the next ui.exe spawns a fresh orchestrator."
                  : "The current orchestrator is preserved."),
            },
          ],
        };
      } catch (e) {
        return fail(`rebuild_ui error: ${(e as Error).message}`);
      }
    },
  );

  // The architect starts with a default lean tool set (CORE + GIT + intent-based). If a
  // specific group is needed it is opened PERSISTENTLY with this tool; persisted in
  // chief.json, open again after restart. Call unload_toolset to undo.
  const loadToolset = tool(
    "load_toolset",
    "Opens additional tool group(s) (persistent, open after restart). Groups: " + ALL_GROUPS.join(", ") + ". For a summary use tool_usage_report.",
    { gruplar: z.array(z.string()).describe("Group names to open (e.g. ['ssh','vault'])") },
    async (args) => {
      const valid: string[] = [];
      const invalid: string[] = [];
      for (const g of args.gruplar) {
        if (ALL_GROUPS.includes(g)) valid.push(g);
        else invalid.push(g);
      }
      if (requestToolset && valid.length) requestToolset(valid);
      const parts: string[] = [];
      if (valid.length) parts.push(`Opened (persistent): ${valid.join(", ")}`);
      if (invalid.length) parts.push(`Invalid: ${invalid.join(", ")} (available: ${ALL_GROUPS.join(", ")})`);
      if (listLoadedToolsets) {
        const tum = listLoadedToolsets();
        parts.push(`Currently open persistent groups: ${tum.length ? tum.join(", ") : "(none)"}`);
      }
      // Fix 137: new tools are active on the NEXT query — enqueue an automatic continue turn,
      // do NOT WAIT for a "continue" message from the user. End this turn briefly (1 sentence),
      // the system starts the autonomous continue turn and proceeds with the new tools.
      if (requestToolsetContinue && valid.length) {
        requestToolsetContinue(valid);
        parts.push("The new tool(s) will be active in the automatic CONTINUE turn — do not wait for a user message. End this turn briefly; the system continues right where you left off.");
      } else {
        parts.push("The new group tools are active on the next turn.");
      }
      return ok(parts.join("\n"));
    },
  );

  // Closes open persistent group(s). Intent-based regex opening is unaffected by this command
  // (an intent mentioned in the message still opens it); it only removes those opened
  // PERSISTENTLY via load_toolset.
  const unloadToolsetTool = tool(
    "unload_toolset",
    "Closes persistent group(s) opened via load_toolset. Intent-based regex openings are unaffected by this command.",
    { gruplar: z.array(z.string()).describe("Group names to close") },
    async (args) => {
      if (unloadToolset && args.gruplar.length) unloadToolset(args.gruplar);
      const parts = [`Closed: ${args.gruplar.join(", ")}`];
      if (listLoadedToolsets) {
        const tum = listLoadedToolsets();
        parts.push(`Currently open persistent groups: ${tum.length ? tum.join(", ") : "(none)"}`);
      }
      return ok(parts.join("\n"));
    },
  );

  return [askUserChoice, restartSelf, rebuildUi, loadToolset, unloadToolsetTool];
}
