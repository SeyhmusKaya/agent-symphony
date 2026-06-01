// Anthropic model fiyat tablosu + per-turn cost hesabi.
//
// Fiyatlar $/M token (2026 Mayis itibariyle Anthropic resmi fiyatlari).
// 1M context beta aktif modellerde fiyat ~2x; model adina "[1m]" eki
// veya gercekten 200k ustu prompt geliyorsa o profili kullan.

export interface ModelPrice {
  input: number; // $/M uncached input
  output: number; // $/M output
  cacheRead: number; // $/M (0.1x input)
  cacheWrite5m: number; // $/M (1.25x input)
  cacheWrite1h: number; // $/M (2x input)
}

const SONNET_46_200K: ModelPrice = {
  input: 3,
  output: 15,
  cacheRead: 0.3,
  cacheWrite5m: 3.75,
  cacheWrite1h: 6,
};
const SONNET_46_1M: ModelPrice = {
  input: 6,
  output: 22.5,
  cacheRead: 0.6,
  cacheWrite5m: 7.5,
  cacheWrite1h: 12,
};
const OPUS_47_200K: ModelPrice = {
  input: 15,
  output: 75,
  cacheRead: 1.5,
  cacheWrite5m: 18.75,
  cacheWrite1h: 30,
};
const OPUS_47_1M: ModelPrice = {
  input: 30,
  output: 112.5,
  cacheRead: 3,
  cacheWrite5m: 37.5,
  cacheWrite1h: 60,
};
// Opus 4.8 (2026-05-28 itibariyle). Regular tier 4.7 ile birebir ayni
// fiyat ($15/$75); FAST tier 3x ucuz ($5/$25) — Anthropic: "ayni model,
// token-by-token daha hizli teslimat, kalite kaybi yok".
const OPUS_48_200K: ModelPrice = {
  input: 15,
  output: 75,
  cacheRead: 1.5,
  cacheWrite5m: 18.75,
  cacheWrite1h: 30,
};
const OPUS_48_1M: ModelPrice = {
  input: 30,
  output: 112.5,
  cacheRead: 3,
  cacheWrite5m: 37.5,
  cacheWrite1h: 60,
};
const OPUS_48_FAST_200K: ModelPrice = {
  input: 5,
  output: 25,
  cacheRead: 0.5,
  cacheWrite5m: 6.25,
  cacheWrite1h: 10,
};
const OPUS_48_FAST_1M: ModelPrice = {
  input: 10,
  output: 37.5,
  cacheRead: 1,
  cacheWrite5m: 12.5,
  cacheWrite1h: 20,
};
const HAIKU_45: ModelPrice = {
  input: 1,
  output: 5,
  cacheRead: 0.1,
  cacheWrite5m: 1.25,
  cacheWrite1h: 2,
};
// DeepSeek V4 (doc: api-docs.deepseek.com/quick_start/pricing). DeepSeek
// otomatik context caching kullanir — ayri "cache write" ucreti YOK; ilk kez
// gorulen token input-miss fiyatindan, tekrar gorulen cache-hit fiyatindan
// faturalanir. ModelPrice shape'ine uydurmak icin cacheWrite5m/1h = input-miss
// (yaklasik; UI $ gosterimi gercege yakin kalir).
const DEEPSEEK_PRO: ModelPrice = {
  input: 0.435, // cache miss
  output: 0.87,
  cacheRead: 0.003625, // cache hit
  cacheWrite5m: 0.435,
  cacheWrite1h: 0.435,
};
const DEEPSEEK_FLASH: ModelPrice = {
  input: 0.14, // cache miss
  output: 0.28,
  cacheRead: 0.0028, // cache hit
  cacheWrite5m: 0.14,
  cacheWrite1h: 0.14,
};

// Model adina gore fiyat sec. Eski API: tek arg, [1m] eki varsa hep 1m
// tier (yanlis — Anthropic gercekte sadece total context >200k oldugunda
// 2x rate uyguluyor). Yeni API: opts.is1m + opts.totalContext ile dogru
// tier sec. Geriye uyum icin tek arg da kabul edilir.
export interface PriceOpts {
  // Chief config'i [1m] beta header ile mi gonderiyor? (modelName'de "[1m]"
  // suffixi SDK'ya gitmeden once cikariliyor — bu yuzden ayri parametre).
  is1m?: boolean;
  // Bu cagrinin gercek total input boyutu (uncached + cache_read + cache_create).
  // Anthropic 1m beta'da SADECE bu deger >200k oldugunda 2x rate.
  totalContext?: number;
}

export function priceForModel(
  modelName: string,
  opts: PriceOpts = {},
): ModelPrice {
  const m = modelName.toLowerCase();
  // DeepSeek: 1m beta / opus tier mantigi gecerli degil — sabit fiyat.
  if (m.includes("deepseek")) {
    return m.includes("pro") ? DEEPSEEK_PRO : DEEPSEEK_FLASH;
  }
  // Fix 104: is1m fallback — opus modelleri daima 1m kullanir, sonnet/haiku
  // daima 200k. Explicit opt verilirse override.
  const explicit1m = opts.is1m;
  const isOpusModel = m.includes("opus");
  const is1m =
    explicit1m !== undefined
      ? explicit1m
      : isOpusModel;
  // Total context biliniyorsa: 1m beta aktif AMA actual context <=200k → 200k tier.
  // Aksi halde 1m tier (asil 2x rate burada).
  const exceeds200k = (opts.totalContext ?? Infinity) > 200_000;
  const useTier2 = is1m && exceeds200k;
  // Opus 4.8 once kontrol et (4-8 substring 4-7 ile karismasin).
  if (m.includes("opus-4-8")) {
    const fast = m.includes("[fast]") || m.includes("-fast");
    if (fast) return useTier2 ? OPUS_48_FAST_1M : OPUS_48_FAST_200K;
    return useTier2 ? OPUS_48_1M : OPUS_48_200K;
  }
  if (m.includes("opus")) return useTier2 ? OPUS_47_1M : OPUS_47_200K;
  if (m.includes("haiku")) return HAIKU_45;
  return useTier2 ? SONNET_46_1M : SONNET_46_200K;
}

export interface UsageBreakdown {
  uncachedInput: number; // taze billed input (no cache)
  cacheRead: number; // 0.1x input
  cacheCreate1h: number; // 1h cache write (proxy bunu ekliyor)
  cacheCreate5m: number; // SDK varsayilan 5m
  output: number;
}

export function estimateCost(b: UsageBreakdown, price: ModelPrice): number {
  return (
    (b.uncachedInput * price.input +
      b.cacheRead * price.cacheRead +
      b.cacheCreate1h * price.cacheWrite1h +
      b.cacheCreate5m * price.cacheWrite5m +
      b.output * price.output) /
    1_000_000
  );
}

// Eger cache_read tokens normal input fiyatindan satin alinsaydi ne
// kadar tutardi - $tasarruf hesabi.
export function cacheReadSavings(cacheRead: number, price: ModelPrice): number {
  return (cacheRead * (price.input - price.cacheRead)) / 1_000_000;
}

export function fmtUsd(n: number): string {
  if (n < 0.005) return "$0.00";
  if (n < 1) return `$${n.toFixed(3)}`;
  if (n < 100) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(0)}`;
}
