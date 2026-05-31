// chat history WS handler — the UI queries the chat history of all sessions,
// including each entry's tool activities and cost. F9 extra split.

import type { SessionStore } from "./sessionStore.js";

export interface ChatHistoryHandlerDeps {
  projectName: string;
  projectId: string;
  chief: SessionStore;
}

export function createChatHistoryHandler(deps: ChatHistoryHandlerDeps) {
  const { projectName, projectId, chief } = deps;

  return async function onChatHistory(
    sessionId?: string,
    limit?: number,
  ): Promise<{ ok: boolean; sonuc?: unknown; hata?: string }> {
    try {
      const allMeta = chief.list();
      const wantList = sessionId
        ? allMeta.filter((m) => m.id === sessionId)
        : allMeta;
      if (sessionId && wantList.length === 0) {
        return { ok: false, hata: `Session not found: ${sessionId}` };
      }
      const sessions = wantList.map((m) => {
        const rec = chief.getById(m.id);
        const fullChat = rec?.chat ?? [];
        const slice = typeof limit === "number" && limit > 0
          ? fullChat.slice(-limit)
          : fullChat;
        // Narrative format: each entry detailed — role, ts, text, aktivite (tool list).
        const entries = slice.map((e) => ({
          role: e.role,
          ts: e.ts,
          tsHuman: new Date(e.ts).toISOString(),
          text: e.text,
          fromAgent: e.fromAgent,
          // Summarize tool activities — make it clear what the chief ran.
          aktivite: (e.aktivite ?? []).map((a) => ({
            ad: a.ad,
            girdi: typeof a.girdi === "string" ? a.girdi.slice(0, 500) : "",
            sonuc: typeof a.sonuc === "string" ? a.sonuc.slice(0, 500) : "",
            hata: a.hata,
          })),
          cost: e.cost,
          imagesCount: e.images?.length ?? 0,
          narrative: e.narrative,
          // ask_user_choice metadata
          askId: e.askId,
          secenekler: e.secenekler,
          answered: e.answered,
          secim: e.secim,
        }));
        return {
          sessionId: m.id,
          sessionName: m.name,
          role: m.role,
          createdAt: m.createdAt,
          lastTurnTs: m.lastTurnTs,
          totalEntries: fullChat.length,
          shownEntries: entries.length,
          chat: entries,
        };
      });
      return {
        ok: true,
        sonuc: {
          projectName,
          projectId,
          totalSessions: allMeta.length,
          sessions,
        },
      };
    } catch (e) {
      return { ok: false, hata: (e as Error).message };
    }
  };
}
