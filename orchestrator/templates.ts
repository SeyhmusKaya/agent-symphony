import { specialistSystemPrompt } from "./prompts.js";

export interface SpecialistTemplate {
  key: string;
  name: string;
  role: string;
  systemPrompt: string;
}

interface TemplateSeed {
  key: string;
  name: string;
  role: string;
}

const SEEDS: TemplateSeed[] = [
  { key: "frontend", name: "Frontend Uzmani", role: "kullanici arayuzu gelistirme (HTML, CSS, modern JS framework'leri)" },
  { key: "backend", name: "Backend Uzmani", role: "sunucu tarafi gelistirme, API tasarimi ve is mantigi" },
  { key: "veritabani", name: "Veritabani Uzmani", role: "veritabani semasi, sorgu optimizasyonu ve migrasyon yonetimi" },
  { key: "muhasebe", name: "Muhasebe Modulu Uzmani", role: "muhasebe modulu kodlamasi; tum muhasebe kurallari ve mali mevzuata hakim" },
  { key: "devops", name: "DevOps Uzmani", role: "dagitim, CI/CD, sunucu yapilandirma ve altyapi" },
  { key: "test", name: "Test Uzmani", role: "otomatik test yazimi, kalite guvence ve hata tespiti" },
  { key: "sosyal-medya", name: "Sosyal Medya Uzmani", role: "icerik stratejisi, platform dinamikleri ve sosyal medya yonetimi" },
  { key: "mimar", name: "Kod Mimari", role: "yazilim mimarisi, sistem tasarimi, modul sinirlari ve teknik karar verme" },
  { key: "kod-inceleme", name: "Kod Inceleme Uzmani", role: "kod incelemesi; hata, guvenlik acigi, performans ve stil sorunlarini tespit ve duzeltme onerisi" },
  { key: "kesif", name: "Kod Kesif Uzmani", role: "kod tabaninda kesif; sembol, tanim ve referanslari bulup haritalama (salt-okunur)" },
  { key: "guvenlik", name: "Guvenlik Uzmani", role: "uygulama guvenligi; acik tespiti, tehdit modelleme ve guvenli kodlama pratikleri" },
];

export const SPECIALIST_TEMPLATES: SpecialistTemplate[] = SEEDS.map((s) => ({
  key: s.key,
  name: s.name,
  role: s.role,
  systemPrompt: specialistSystemPrompt(s.name, s.role),
}));

export function getTemplate(key: string): SpecialistTemplate | undefined {
  return SPECIALIST_TEMPLATES.find((t) => t.key === key);
}
