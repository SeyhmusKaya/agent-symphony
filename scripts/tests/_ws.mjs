// Shared WS test helper. Collected here to keep each test small.
// The orchestrator runs one WS server per project. Ports:
//   Mimar(coordinator)=4316, EmlakCopilot=4318, "google yorum"=4319.
// For live tests EmlakCopilot 4318 (a legitimate project) is the default.
//
// CLIENT->SERVER messages (JSON):
//   { kind:"komut", text, sessionId? }                      -> command to the active sef
//   { kind:"kontrol", aksiyon:"durdur"|"duraklat"|"devam", sessionId? }
// SERVER->CLIENT event kinds (partial):
//   sef_tur_basladi, sef_parcali{delta}, sef_aktivite{id,ad,durum},
//   sef_aktivite_io{id,ioKind:"girdi"|"sonuc",text,hata?}, sef_token{...},
//   sef_cevap (turn finished), sef_idle, durum{payload}.
import WebSocket from "ws";

export const PORTS = { mimar: 4316, emlak: 4318, googleYorum: 4319 };

// argv[2] port override; otherwise EmlakCopilot 4318.
export function portFromArgv(def = 4318) {
  const p = Number(process.argv[2]);
  return Number.isFinite(p) && p > 0 ? p : def;
}

// Is a single tool name codegraph (code_* / search_docs etc.)?
export const CODEGRAPH_RX =
  /code_search|code_node|code_callers|code_callees|code_files|code_impact|code_imports|search_docs|get_doc_outline|list_docs|code_stats|mcp__architect__/i;
// Builtin raw search tools.
export const RAW_SEARCH_RX = /^(Grep|Bash|Glob)$/;
// Trace of the old hard-deny (removed in Fix 122).
export const DENY_RX = /KOD ARAMA YASAK|reddedildi/i;

// Connect to a port. Promise<WebSocket>.
export function connect(port, timeoutMs = 6000) {
  return new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const tm = setTimeout(() => {
      try { ws.close(); } catch {}
      rej(new Error(`connection timeout port=${port} (is the orchestrator running?)`));
    }, timeoutMs);
    ws.once("open", () => { clearTimeout(tm); res(ws); });
    ws.once("error", (e) => { clearTimeout(tm); rej(e); });
  });
}

// Send a command (to the active sef session). sessionId optional.
export function sendKomut(ws, text, sessionId) {
  const msg = { kind: "komut", text };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
}

// Send a control: durdur | duraklat | devam.
export function sendKontrol(ws, aksiyon, sessionId) {
  const msg = { kind: "kontrol", aksiyon };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
}

// Event collector. Dispatches every incoming JSON event to the hooks.
// Returned Collector:
//   .tools[]      -> { ad, durum } in order (only "calisiyor" is added by default)
//   .toolOrder[]  -> tool names (calisiyor) in order
//   .deltas[]     -> sef_parcali delta texts
//   .ioResults[]  -> sef_aktivite_io results {text,hata}
//   .tokens[]     -> sef_token payloads (last = most current)
//   .raw[]        -> all events (debug)
//   .completed    -> whether sef_cevap arrived
//   .onTool(fn)   .onDelta(fn)  .onToken(fn)  .onIo(fn)  .onAny(fn)
//   .waitForCevap(ms) -> Promise (resolves on sef_cevap, does not reject on timeout; verdict is in the caller)
export function collect(ws) {
  const c = {
    tools: [], toolOrder: [], deltas: [], ioResults: [], tokens: [], raw: [],
    completed: false,
    _onTool: [], _onDelta: [], _onToken: [], _onIo: [], _onAny: [], _onCevap: [],
    onTool(fn) { c._onTool.push(fn); return c; },
    onDelta(fn) { c._onDelta.push(fn); return c; },
    onToken(fn) { c._onToken.push(fn); return c; },
    onIo(fn) { c._onIo.push(fn); return c; },
    onAny(fn) { c._onAny.push(fn); return c; },
    // Wait for sef_cevap. On timeout resolve("timeout") (no hard-crash).
    waitForCevap(ms = 120000) {
      return new Promise((res) => {
        if (c.completed) return res("cevap");
        const tm = setTimeout(() => res("timeout"), ms);
        c._onCevap.push(() => { clearTimeout(tm); res("cevap"); });
      });
    },
    // Verify the delta/tool stream has stopped: no new delta/activity during the window.
    // -> { deltaSayisi, aktiviteSayisi } new events within the window.
    watchSilence(ms) {
      const startDelta = c.deltas.length;
      const startTool = c.toolOrder.length;
      return new Promise((res) => {
        setTimeout(() => res({
          deltaSayisi: c.deltas.length - startDelta,
          aktiviteSayisi: c.toolOrder.length - startTool,
        }), ms);
      });
    },
  };
  ws.on("message", (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    c.raw.push(m);
    for (const fn of c._onAny) try { fn(m); } catch {}
    if (m.kind === "sef_aktivite") {
      if (m.durum === "calisiyor" && m.ad) { c.toolOrder.push(m.ad); }
      c.tools.push({ ad: m.ad, durum: m.durum, id: m.id });
      for (const fn of c._onTool) try { fn(m); } catch {}
    } else if (m.kind === "sef_parcali" && typeof m.delta === "string") {
      c.deltas.push(m.delta);
      for (const fn of c._onDelta) try { fn(m); } catch {}
    } else if (m.kind === "sef_aktivite_io") {
      if (m.ioKind === "sonuc") c.ioResults.push({ text: m.text ?? "", hata: m.hata });
      for (const fn of c._onIo) try { fn(m); } catch {}
    } else if (m.kind === "sef_token") {
      c.tokens.push(m);
      for (const fn of c._onToken) try { fn(m); } catch {}
    } else if (m.kind === "sef_cevap") {
      c.completed = true;
      for (const fn of c._onCevap) try { fn(m); } catch {}
    }
  });
  return c;
}

// Sleep helper.
export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// Print the standard verdict line. Exit is always 0 (so the runner can aggregate).
export function bitir(ws, baslik, satirlar, verdict) {
  console.log("\n===== " + baslik + " =====");
  for (const s of satirlar) console.log(s);
  console.log("RESULT: " + verdict);
  try { ws && ws.close(); } catch {}
  process.exit(0);
}
