export type EventType =
  | "delege_basladi"
  | "delege_bitti"
  | "worker_spawn"
  | "worker_done"
  | "peer_istek"
  | "commit"
  | "hata"
  | "token_guncelleme"
  | "ajan_durum_degisti"
  | "dosya_degisti"
  | "ajan_transcript"
  | "sefler_arasi"
  // F3 (otonom 3-gun modu) — UI ws broadcast + audit logu.
  | "autonomous_notification"
  | "autonomous_progress"
  | "autonomous_checkpoint";

export interface EventPayloads {
  delege_basladi: { agent: string; task: string };
  delege_bitti: { agent: string; isError: boolean; peer?: boolean };
  worker_spawn: { task?: string; count?: number };
  worker_done: { task?: string; count?: number; isError?: boolean; transcript?: string };
  peer_istek: { peer: string; request: string };
  commit: { hash: string; mesaj: string };
  hata: { agent?: string; mesaj: string };
  token_guncelleme: { agent: string; input: number; output: number };
  ajan_durum_degisti: { agent: string; durum: string; skill?: string };
  dosya_degisti: { agent: string; file: string; diff: string };
  ajan_transcript: { agent: string; transcript: string };
  sefler_arasi: {
    // Fix 131: kaynak = gercek gonderen sef adi (UI panelinde sabit "Mimar"
    // yerine bunu gosterir). Opsiyonel — eski event'lerde olmayabilir.
    kaynak?: string;
    hedef: string;
    mesaj: string;
    cevap?: string;
    isError?: boolean;
    cost?: {
      in?: number;
      out?: number;
      cacheRead?: number;
      cacheCreate1h?: number;
      usd?: number;
      model?: string;
    };
  };
  // F3 (otonom 3-gun modu): payload generic — Notifier ve AutonomousManager
  // farkli ek alanlar yolluyor (kind, title, body, meta, jobId, sayilar).
  // Bu yuzden indexed Record olarak duruyor; EventBus cast'i type-safe degil
  // ama main.ts'in `bus.emit(type as EventType, payload as never)` patternine
  // uyumlu.
  autonomous_notification: Record<string, unknown>;
  autonomous_progress: Record<string, unknown>;
  autonomous_checkpoint: Record<string, unknown>;
}

export interface ArchitectEvent<T extends EventType = EventType> {
  type: T;
  payload: EventPayloads[T];
  ts: number;
}

type Listener = (e: ArchitectEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();
  private history: ArchitectEvent[] = [];

  emit<T extends EventType>(type: T, payload: EventPayloads[T]): void {
    const e: ArchitectEvent = { type, payload, ts: Date.now() };
    this.history.push(e);
    for (const l of this.listeners) l(e);
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getHistory(): ArchitectEvent[] {
    return [...this.history];
  }
}
