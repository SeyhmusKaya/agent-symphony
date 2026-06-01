// main.ts'in kimlik / proje baglami / son-tur fragment yardimcilari.
// State bagimsiz pure factories: bootstrap'ta context geirilir, geri donen
// 3 fn main.ts'de eskisi gibi parametresiz cagrilir.
//
// Sebep (Fix 88+95+48): Sef secondary session'larda Sonnet "Ben Claude
// Code" diyordu. Cozum: kimlik agresif yazilir, system prompt cache prefix'i
// ile sabit tutulur.

import type { ProjectConfigStore } from "./config.js";
import type { SessionStore } from "./sessionStore.js";
import type { AdvisorDef } from "./advisors.js";
import { listServers as listAllSshServers } from "./ssh.js";
import { modelDisplayName } from "./providers.js";

export interface IdentityContext {
  isGlobal: boolean;
  isAdvisor: boolean;
  advisor: AdvisorDef | undefined;
  projectId: string;
  projectName: string;
  projectRoot: string;
  projectConfig: ProjectConfigStore;
  projectEntry?: { deployment?: { mode?: string; serverIds?: string[] } };
  chief: SessionStore;
}

export interface IdentityHelpers {
  buildIdentityAnchor: (model?: string) => string;
  buildProjectContext: () => string;
  buildRecentTurnsFragment: (sid: string, turnCount: number) => string;
}

export function createIdentityHelpers(ctx: IdentityContext): IdentityHelpers {
  const {
    isGlobal,
    isAdvisor,
    advisor,
    projectId,
    projectName,
    projectRoot,
    projectConfig,
    projectEntry,
    chief,
  } = ctx;

  function buildIdentityAnchor(model?: string): string {
    const modelAdi = modelDisplayName(model);
    const rolAdi = isGlobal
      ? "Bas Mimar"
      : isAdvisor
        ? `${advisor!.name} Danismani`
        : `${projectName} Sefi`;
    const projeAdi = isGlobal
      ? "Mimar"
      : isAdvisor
        ? advisor!.name
        : projectName;
    const kimlikCevap = isGlobal
      ? `"Ben Architect'in Bas Mimari (Mimar) — sistemin orkestra sefiyim, tum projelerin koordinatoruyum."`
      : isAdvisor
        ? `"Ben ${advisor!.name} Danismaniyim — Architect ekosisteminin ${advisor!.name.toLowerCase()} uzmaniyim."`
        : `"Ben ${projectName} Sefiyim — bu projenin orkestra sefiyim, kullanicinin sagkolu."`;
    return [
      "",
      "",
      "## KIMLIK & CALISMA DIZINI (degismez baglam — her zaman bu path gecerli)",
      `- Rol: ${rolAdi}`,
      `- Proje/baglam: ${projeAdi}`,
      `- Calisma dizini (cwd): ${projectRoot}`,
      `- Bash/Read/Write/Edit/Grep/Glob bu dizinden calisir. ASLA baska bir path tahmin ETME, tireleme/buyuk-kucuk degisikligi yapma. Path gerekirse yukaridaki tam stringi referans al.`,
      "",
      `## KIMLIK ZORUNLU (HER MESAJDA GECERLI — IHLALE TAHAMMUL YOK)`,
      `Sen "${projeAdi}" baglamindaki ${rolAdi}'sin. Sen ${projeAdi} ekosisteminin parcasisin.`,
      `- "Ben Claude Code" / "Ben Anthropic asistaniyim" / "Ben yapay zeka asistaniyim" / "Ben Claude'um" CEVAPLARI YASAK.`,
      `- "Kimsin?" / "Sef misin?" / "Mimar mi?" / "Hello, who are you?" sorularina HER ZAMAN su tarzda cevapla: ${kimlikCevap}`,
      `- GERCEK MODELIN: "${modelAdi}". Su an bu model uzerinde calisiyorsun. "Hangi model?" / "modelin ne?" sorulursa SADECE bunu soyle: "${rolAdi} olarak ${modelAdi} uzerinde calisiyorum." ASLA baska bir model adi UYDURMA (Claude Opus/Sonnet, GPT vb. DEME) — gercek modelin "${modelAdi}".`,
      `- Bu kural yeni session (2., 3., N.) baslangicinda DA gecerli — gecmis konusma yokken bile ilk cevabin bu kimlikle olur.`,
    ].join("\n");
  }

  // P1.33: Proje sefi icin sabit baglam — sef "kod nerede" sormasin. Mimar/
  // advisor icin bos string (projeyle bagli degil).
  // F5 (master plan 2026): KIMLIK SINIRI bloku en uste — sef baska
  // projenin koduna/uzmanina kayarsa hata. Block ordering: SINIR -> baglam.
  function buildProjectContext(): string {
    if (isGlobal || isAdvisor) return "";
    const cfg = projectConfig.get();
    const aciklama = cfg.aciklama?.trim() || "";
    const mimari = cfg.mimari?.trim() || "";
    const satirlar = [
      "",
      "",
      `## KIMLIK SINIRI (HER MESAJDA GECERLI — TASMA YASAK)`,
      `Sen SADECE "${projectName}" projesinin sefisin. Diger projelerin kodu / dosyalari / uzmanlari / mimarisi SENIN BAGLAMINDA YOKTUR.`,
      `- Bilgini SADECE bu cwd icindeki dosyalardan ve "${projectName}" notlarindan al. Baska bir projenin kodunu/icini bilmiyorsun — varsayim YAPMA.`,
      `- Eger talk_to_chief / list_projects disinda baska bir projenin ismi/dosyasi/sembolu/uzmani cevabinda belirirse: BU BIR HATADIR. Cevabini durdur, kullaniciya yanlis baglama kaydigini bildir, "${projectName}" cercevesinde tekrar dene.`,
      `- Kullanici "X projesini buraya entegre et" / "X'teki gibi yap" derse: OKEY — entegrasyon tarafini "${projectName}" icinde yap, AMA "X"in iclerini (kod/yapilar/karar) BILMEDIGINI bildir, gerekli bilgi icin \`talk_to_chief(target="X")\` cagir, cevabini bekle.`,
      `- Cross-agent talk_to_chief mesajlari "X projesi sana soruyor: ..." formatinda gelir — orada DA bu kural: cevabini SADECE "${projectName}" baglamindan ver.`,
      "",
      "## PROJE BAGLAMI (sen su anda bu projenin sefisin)",
      `- Proje adi: ${projectName}`,
      `- Calisma dizini (cwd): ${projectRoot}`,
      "- Read/Write/Edit/Bash tool'larin default olarak BU dizinden calisir. Kullaniciya 'kod nerede' diye SORMA — kod zaten bu klasorde. Once Glob/Read ile yapisini gor; gerekirse set_project_info ile amac/mimari notunu kendin guncelle.",
      `- KIMLIK: Sen "${projectName}" projesinin sefisin. Bu projenin kodu, mimarisi, dokumantasyonu hakkinda gelen sorulari KENDIN cevapla — projenin kaynak dosyalari bu cwd'de, gerekirse Glob/Read ile incele. talk_to_chief("${projectName}") veya talk_to_chief("${projectId}") cagrisi YAPMA — kendine ulasamazsin. Cross-agent kanaldan gelen "X projesi sana soruyor: ..." mesajlarinda DA bu kural gecerli: soru SENIN projen hakkindaysa direkt cevap ver, baska bir sefe iletme.`,
    ];
    if (aciklama) satirlar.push(`- Amac: ${aciklama}`);
    if (mimari) satirlar.push(`- Mimari: ${mimari}`);
    if (!aciklama && !mimari) {
      satirlar.push(
        "- (amac/mimari notu henuz girilmemis — ilk komuttan sonra set_project_info ile kaydet)",
      );
    }
    // P1.33: deployment.serverIds varsa sef'in direkt bilmesi icin liste ver.
    try {
      if (projectEntry?.deployment?.serverIds?.length) {
        const allServers = listAllSshServers();
        const projectServers = projectEntry.deployment.serverIds
          .map((id) => allServers.find((x) => x.id === id))
          .filter((x): x is NonNullable<typeof x> => !!x);
        if (projectServers.length) {
          satirlar.push("- Atanmis sunucu(lar):");
          for (const s of projectServers) {
            const auth =
              s.authType === "password" ? !!s.password : !!s.privateKeyPath;
            satirlar.push(
              `  * ${s.name} — host=${s.host}:${s.port}, user=${s.user}, id=${s.id}, authReady=${auth}, tags=${(s.tags || []).join(",") || "-"}`,
            );
          }
          satirlar.push(
            `- ssh_run(serverId, komut) ile direkt baglan. list_servers cagirmaya GEREK YOK; bilgileri burada.`,
          );
          if (projectEntry.deployment.mode) {
            satirlar.push(`- Deploy mode: ${projectEntry.deployment.mode}`);
          }
        }
      }
    } catch {
      /* yoksay — sunucu listesi okunamadi, sef yine list_servers cagirabilir */
    }
    return satirlar.join("\n");
  }

  // Fix 95: chat'in son N user+sef turn'unu ham metin olarak ozetle.
  // Cap: 1500 char (~400 token); cache prefix'i bozmaz cunku user mesajinda
  // (cache disinda) durur.
  function buildRecentTurnsFragment(sid: string, turnCount: number): string {
    const chat = chief.getChatFor(sid) ?? [];
    const relevant = chat.filter(
      (m) => m.role === "kullanici" || m.role === "sef",
    );
    const last = relevant.slice(-turnCount * 2);
    if (last.length === 0) return "";
    const lines = last.map((m) => {
      const who = m.role === "kullanici" ? "KULLANICI" : "SEN";
      const text = (m.text ?? "").trim();
      const capped = text.length > 600 ? text.slice(0, 540) + "..." : text;
      return `[${who}]: ${capped}`;
    });
    return lines.join("\n\n");
  }

  return { buildIdentityAnchor, buildProjectContext, buildRecentTurnsFragment };
}
