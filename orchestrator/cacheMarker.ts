// Cache prefix boundary marker — paylasilir sabit.
//
// Amac: systemPrompt'u 2 cache bloguna bolmek. Marker'in solunda kalan kisim
// "immutable prefix" (cache_control alir, prompt cache hit'lerinin hedefi).
// Marker'in saginda kalan "mutable suffix" (memSys, compactSys, planSys gibi
// her turde degisebilen icerikler) — cache_control almaz, ucuz uncached
// input olarak gider.
//
// Marker icerigi ASCII, escape gerektirmez. Anthropic API bunu duz metin
// olarak tasir; proxy strip eder. Eger SDK herhangi bir esya tasir ya da
// escape ederse split etkisiz kalir (cache_control yine son bloka uygulanir)
// — fonksiyonel olarak gerileme; performans gerilemesi olur sadece.
export const CACHE_BOUNDARY = "\n\n<<<ARCHITECT_CACHE_BOUNDARY>>>\n\n";
