import type { IconName } from "$lib/icons/paths";

/* Corporate icon based on the expert's function — inspects name + role text. */
const RULES: { keys: string[]; icon: IconName }[] = [
  { keys: ["pazarlama", "marketing", "kampanya", "growth", "büyüme", "reklam"], icon: "megaphone" },
  { keys: ["seo", "arama", "anahtar kelime", "icerik optimiz"], icon: "search" },
  { keys: ["trading", "piyasa", "borsa", "yatirim", "trade"], icon: "trendingUp" },
  { keys: ["hukuk", "kvkk", "yasal", "sozlesme", "legal", "uyum"], icon: "scale" },
  { keys: ["finans", "butce", "mali", "finance"], icon: "coins" },
  { keys: ["muhasebe", "defter", "vergi", "kdv", "fatura"], icon: "calculator" },
  { keys: ["devops", "altyapi", "deploy", "sunucu", "ci/cd", "infra"], icon: "server" },
  { keys: ["veri", "data", "analitik", "metrik", "analiz"], icon: "database" },
  { keys: ["ux", "tasarim", "design", "arayuz", "ui"], icon: "palette" },
  { keys: ["sosyal", "social", "platform", "topluluk"], icon: "share" },
  { keys: ["mimar", "architect", "koordin"], icon: "compass" },
  { keys: ["yazilim", "kod", "developer", "backend", "frontend", "engineer"], icon: "terminal" },
  { keys: ["dokuman", "rapor", "icerik", "yazar", "metin"], icon: "fileText" },
];

export function agentIcon(...text: (string | undefined)[]): IconName {
  const hay = text.filter(Boolean).join(" ").toLowerCase();
  for (const r of RULES) {
    if (r.keys.some((k) => hay.includes(k))) return r.icon;
  }
  return "bot";
}
