<div align="center">

<img src="docs/img/banner.png" alt="Architect — Agent Symphony" width="100%" />

# Architect — Agent Symphony

### Claude Agent SDK için hiyerarşik çok ajanlı orkestratör — çoklu sağlayıcı (Claude + DeepSeek)

*Tek bir orkestra şefi. Bir bölük AI ajanı. Komuta sizde.*

[![Sponsor](https://img.shields.io/github/sponsors/SeyhmusKaya?style=for-the-badge&logo=githubsponsors&color=ea4aaa)](https://github.com/sponsors/SeyhmusKaya)
[![Stars](https://img.shields.io/github/stars/SeyhmusKaya/agent-symphony?style=for-the-badge&color=f59e0b)](https://github.com/SeyhmusKaya/agent-symphony/stargazers)
[![Release](https://img.shields.io/github/v/release/SeyhmusKaya/agent-symphony?style=for-the-badge&color=8b5cf6)](https://github.com/SeyhmusKaya/agent-symphony/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/SeyhmusKaya/agent-symphony/ci.yml?branch=main&style=for-the-badge&label=build)](https://github.com/SeyhmusKaya/agent-symphony/actions)
[![Last commit](https://img.shields.io/github/last-commit/SeyhmusKaya/agent-symphony?style=for-the-badge&color=10b981)](https://github.com/SeyhmusKaya/agent-symphony/commits/main)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e.svg?style=for-the-badge)](LICENSE)
[![Built with Claude Agent SDK](https://img.shields.io/badge/Built%20with-Claude%20Agent%20SDK-0F766E?style=for-the-badge)](https://docs.anthropic.com/en/api/agent-sdk)
[![Desktop: Tauri](https://img.shields.io/badge/Desktop-Tauri%20%2B%20SvelteKit-24c8db?style=for-the-badge&logo=tauri)](https://tauri.app)

<br/>

**Türkçe** · [English](README.md) · [中文](README.zh.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Português](README.pt.md)

</div>

---

## 💜 Destek / Bağış

**Architect — Agent Symphony ücretsiz ve açık kaynaktır, tek bir geliştirici tarafından geliştirilmiştir.** Size zaman kazandırıyorsa ya da fikri hoşunuza gidiyorsa, yapacağınız bir bağış ajanların çalışmaya ve geliştirmenin ilerlemeye devam etmesini sağlar. Teşekkürler. 🙏

### ⭐ GitHub Sponsors (önerilen)
Destek olmanın en kolay yolu — tek tıkla, tekrarlayan veya tek seferlik, **%0 platform ücreti** (tamamı yazara ulaşır):

👉 **[github.com/sponsors/SeyhmusKaya](https://github.com/sponsors/SeyhmusKaya)**

### ₿ Kripto

| Varlık | Ağ | Adres |
|-------|---------|---------|
| **USDT** | **TRC20** (Tron) | `TD5DADsYjH3aydsi7zrgDrqVAj3EzWx1Cb` |
| **BTC** | **Bitcoin** | `12W1kc6qvDEwG9QfdjHWtdT2QEKDrTApWm` |
| **ETH** | **ERC20** (Ethereum) | `0x8d0ba54ba688fe70f1f3888ad494817b9fdebc7b` |

> ⚠️ **Her varlığı yalnızca yukarıda gösterilen ağ üzerinden gönderin.** Yanlış ağ üzerinden gönderim, fonların kalıcı olarak kaybedilmesine yol açabilir.

---

## ✨ Bu nedir?

**Architect — Agent Symphony**, Claude Agent SDK'yı **bir şirket gibi yönettiğiniz hiyerarşik bir AI ajan organizasyonuna** dönüştüren bir masaüstü uygulamasıdır.

Tek bir asistanla sohbet etmek yerine, **uzmanlaşmış ajanlardan oluşan bir organizasyon şeması** çalıştırırsınız: bir baş mimar proje şeflerini koordine eder, her şef kendi kalıcı uzmanlarına komuta eder, bir alan danışmanları kuruluna danışır ve tek seferlik işçiler görevlendirir — hepsi paralel olarak, hepsi tek bir kokpitte, tam maliyet görünürlüğü ve Claude Code seviyesinde bağlam yönetimiyle.

Bunu **bir Claude ajan ekibi için görev kontrol merkezi** olarak düşünün — gerçek, çok projeli yazılım işlerini orkestre etmek için özel olarak tasarlanmıştır.

### 🧭 Nereye oturuyor

**Claude Code**, **CrewAI**, **AutoGen** ya da **LangGraph** kullandıysanız: bunlar *betik yazdığınız* çerçeveler ve CLI'lardır. **Architect — Agent Symphony** ise **orkestrasyonun *kendisinin* ürün olduğu bir masaüstü kokpitidir** — orkestrasyon kodu yazmak yerine, gerçek projeler genelinde sürekli faaliyette olan bir ajan organizasyonunu canlı maliyet ve bağlam görünürlüğüyle izler ve komuta edersiniz. Doğrudan resmi **[Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk)** üzerine inşa edilmiştir (süreç içi, ayrı bir CLI yok), böylece üstüne eklenmiş çok ajanlı, çok projeli bir arayüzle birlikte Claude Code seviyesinde davranış elde edersiniz.

**Anahtar kelimeler:** Claude ajan orkestrasyonu · DeepSeek ajan orkestrasyonu · çoklu sağlayıcılı LLM ajanları · çok ajanlı AI · ajan tabanlı iş akışları · otonom kodlama ajanları · Claude Code alternatif arayüzü · DeepSeek V4 masaüstü uygulaması · AI yazılım ekibi · MCP araçları.

---

## 🌟 Onu farklı kılan ne

- 🧬 **Ajan başına yetenekler** — her ajan **kendi** yetenek (skill) dosyalarını yükler. İsim etiketi takmış genel bir sohbet botu değil, derin alan bilgisine sahip gerçek bir uzman inşa edersiniz.
- 🤖 **Göreve göre otomatik atanan yetenekler** — bir şef yeni bir uzman oluşturduğunda, iş için **doğru alan yeteneklerini otomatik olarak devralır**: bir tasarım uzmanı tasarım yeteneklerini, bir güvenlik uzmanı güvenlik yeteneklerini alır.
- 🗂️ **Projeleri tarayıcı sekmeleri gibi gezin** — birden fazla **canlı proje ve paralel oturum** arasında, her biri kendi ajanları, bağlamı, geçmişi ve maliyet sayacıyla birlikte Chrome sekmeleri gibi geçiş yapın.
- 💬 **Ajanlar birbiriyle konuşur** — şefler danışmanlara danışır ve diğer proje şeflerine mesaj gönderir; işler sadece sizin yukarıdan dikte etmenizle değil, *ajanlar arasında müzakere edilerek* yürütülür.
- 🌙 **Gece boyunca kendini geliştirir** — baş Architect **her gece kendi kod tabanını analiz edip iyileştirmeleri otonom olarak önerebilir / yayınlayabilir**, böylece siz uyurken orkestratör daha da iyiye gitmeye devam eder.
- ⚡ **Varsayılan olarak paralel** — bağımsız alt görevler aynı anda birçok ajana dağıtılır, ardından orkestra şefi sonuçları birleştirir.

---

## 📸 Kokpit

<div align="center">
<img src="docs/img/app-screenshot.png" alt="Architect — Agent Symphony desktop cockpit" width="100%" />
</div>

---

## 🎼 Senfoni — hiyerarşi nasıl çalar

<div align="center">
<img src="docs/img/architecture.png" alt="Architecture: Architect → Project Chiefs → Specialists / Workers, with a panel of Advisors" width="92%" />
</div>

```
                        🏛️  ARCHITECT  (the conductor)
                        coordinates everything, owns the ecosystem
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
   👔 PROJECT CHIEF             👔 PROJECT CHIEF              🎓 ADVISORS (11, fixed)
   owns one project            owns another project          domain decision support
   git · ssh · deploy          git · ssh · deploy            design · SEO · security
        │                             │                       legal · finance · data
        ├── 🧑‍💻 Specialist          ├── 🧑‍💻 Specialist        devops · marketing · …
        ├── 🧑‍💻 Specialist          └── ⚡ Worker (one-shot)   (consulted on demand)
        └── ⚡ Worker (one-shot)
```

| Rol | Nedir | Yaşam süresi |
|------|-----------|----------|
| 🏛️ **Architect** | Orkestra şefi. Tüm ekosistemi koordine eder, orkestratörün kendisini geliştirir, işleri şefler arasında yönlendirir. | Her zaman açık |
| 👔 **Project Chief** | Proje başına bir tane. Projenin kıdemli mühendisi — koda, git'e, ssh/deploy'a sahiptir. Diğer şeflerle konuşur. | Kalıcı |
| 🧑‍💻 **Specialist** | Bir şefin kalıcı uzmanı (örn. *Frontend Specialist*, *Backend Specialist*). İzole bir paralel ajan penceresinde kod yazar ve düzenler. | Kalıcı |
| 🎓 **Advisor** | 11 sabit alan uzmanı (tasarım/UI, SEO, güvenlik, hukuk, pazarlama, finans, muhasebe, veri, devops, sosyal medya, ticaret). Karar desteği — kod yazmazlar. | Yerleşik |
| ⚡ **Worker** | Hızlı keşif ya da tek bir düzenleme için tek seferlik, anonim bir ajan. | Geçici |

Ajanlar birbiriyle konuşur (ajanlar arası mesajlaşma), paralel olarak görev devreder ve orkestra şefi sonuçları birbirine bağlar — böylece tek bir talimat verirsiniz ve koca bir ekip uygular.

---

## 🚀 Özellikler

### 🧠 Claude Code seviyesinde bağlam mühendisliği
- **Yerel SDK sıkıştırması (compaction)** — bağlam, Claude Code'un yaptığı gibi *aynı oturumun içinde* sıkıştırılır (oturum kimliği korunur); ayrıca özetle-ve-taşı (summarize-and-carry-forward) eski yedek mekanizmasıyla bir ajan **çalışma belleğini asla kaybetmez**.
- **Oturum başına, ajan başına token ve maliyet takibi** — her tur taze / önbellek-okuma / önbellek-yazma tokenlarını ve tam USD maliyetini gösterir.
- **Prompt önbelleğine duyarlı tasarım** — kararlı araç setleri ve önbellek dostu prompt düzeni önbellek isabet oranlarını yüksek tutar (pahalı yeniden yazmalar yerine ucuz okumalar).
- **Tembel araç grupları** — ajanlar araç setlerini talep üzerine yükler (`load_toolset`) ve böylece tur başına token tabanını düşük tutar.

### 🔀 Çoklu sağlayıcılı model yönlendirmesi (Claude + DeepSeek)
- **İki sağlayıcı, tek kokpit** — ajanları **Anthropic Claude** (Opus / Sonnet / Haiku) **veya DeepSeek V4** (`deepseek-v4-pro` / `deepseek-v4-flash`) üzerinde çalıştırın. Aynı açılır menüden ajan başına modeli seçin.
- **Otomatik sağlayıcı önceliği** — bir DeepSeek API anahtarı ayarlanmışsa önce DeepSeek kullanılır; aksi halde bir Anthropic API anahtarı; o da yoksa Claude Pro/Max girişiniz. Kod değişikliği gerekmez.
- **DeepSeek'te mantıklı rol varsayılanları** — şefler, baş mimar ve danışmanlar varsayılan olarak **DeepSeek V4 Pro**'yu, tek seferlik uzmanlar/işçiler ise daha ucuz olan **DeepSeek V4 Flash**'ı kullanır.
- **Nasıl çalışır** — DeepSeek'e **Anthropic uyumlu uç noktası** (`https://api.deepseek.com/anthropic`) üzerinden erişilir; böylece aynı Agent SDK istek formatı, araç çağrıları, düşünme (thinking) modu ve 1M tokenlık bağlam penceresi değişmeden çalışır. Model başına, token başına USD maliyeti her sağlayıcı için doğru şekilde takip edilir.
- **Canlı geçiş** — çalışan bir ajanın modelini oturum ortasında Claude'dan DeepSeek'e (ya da geri) değiştirin; yönlendirme her istekte seçili modeli izler.

### 🕸️ CodeGraph — anlamsal kod zekâsı
Depolarınız üzerinde yerleşik bir kod grafiği (TypeScript, JavaScript, Python, PHP, C#, Dart ve Svelte için **tree-sitter** + **SQLite FTS** + gömme vektörleri (embeddings) ile desteklenir):
- `code_search`, `code_node`, `code_callers`, `code_callees`, `code_impact`, `code_imports`, `code_files`, `code_stats`
- Ajanlar körlemesine grep yapmak yerine grafiği sorgular — daha hızlı, daha ucuz, daha doğru. Dosya değişikliklerinde otomatik olarak yeniden indekslenir.

### 👥 Çok ajanlı orkestrasyon
- **Paralel görev devri** — bağımsız alt görevler tek bir partide birden fazla ajana dağıtılır.
- Kendi kimliği, yetenekleri ve sohbet geçmişine sahip **kalıcı uzmanlar**.
- **Ajanlar arası iletişim** — şefler danışmanlara danışır ve birbirlerine mesaj gönderir (`talk_to_chief`).
- **Canlı etkinlik görünümü** — çalışan herhangi bir uzmana tıklayarak aldığı prompt'u ve şu anda ne yaptığını görün.
- **Arka planda görev devri** — uzun süre çalışacak bir uzmanı başlatıp şefle sohbete devam edin; sonuçlar hazır olduğunda geri akar.

### 🗂️ Çok projeli, çok oturumlu kokpit
- Her biri kendi şefi ve ajanlarına sahip birçok projeyi yönetin.
- Ajan başına, Claude Code tarzında, her biri kendi bağlamı, maliyeti ve geçmişine sahip birden fazla paralel oturum.
- Oturumlar **asla sessizce sıfırlanmaz** — bağlamınız durdurmalardan, yeniden başlatmalardan ve yeniden denemelerden sağ çıkar.

### 🛠️ Gerçek dünya operatör araçları
- Projeleri sunuculara göndermek için **SSH / deploy** araçları.
- Kimlik bilgileri için **gizli kasa (secret vault)** (asla commit edilmez).
- **Rol başına yetenekler** — uzmanlara ve danışmanlara alan SKILL dosyaları ekleyin.
- **Otonom mod** — bir ajana çok günlük bir hedef verip çalışmasına izin verin, duraklatın ve devam ettirin.
- Playwright aracılığıyla **tarayıcı otomasyonu ve görsel üretimi**.
- Bir üst sınıra ulaşıldığında otomatik olarak daha ucuz bir modele geçen **bütçe kontrolü**.

### 🎨 Gerçekten hoş bir masaüstü uygulaması
**Tauri + SvelteKit** ile inşa edilmiştir — hızlı, yerel bir masaüstü kokpiti (tarayıcı sekmesi değil); temiz, özel tasarımlı koyu bir arayüzle: gradyan başlıklar, kart tabanlı ajan listeleri, canlı token göstergeleri, bir CodeGraph gezgini, raporlar ve notlar.

---

## 🧩 Teknoloji yığını

| Katman | Teknoloji |
|-------|------|
| **Ajanlar** | [Claude Agent SDK](https://docs.anthropic.com/en/api/agent-sdk) (süreç içi) |
| **Model sağlayıcıları** | Anthropic Claude (Opus / Sonnet / Haiku) · DeepSeek V4 (Pro / Flash), Anthropic uyumlu uç nokta üzerinden |
| **Backend** | `tsx` üzerinde TypeScript, WebSocket (`ws`), Zod |
| **Kod zekâsı** | tree-sitter (7 dil) + `better-sqlite3` (FTS) + gömme vektörleri |
| **Otomasyon** | Playwright / Patchright |
| **Masaüstü arayüzü** | Tauri (Rust) + SvelteKit |

---

## 📦 Başlangıç

> **Durum:** Yazar tarafından gerçek, çok projeli yazılım işlerini yürütmek için **her gün üretimde aktif olarak kullanılıyor** — bu bir demo ya da terk edilmiş bir yazılım değildir. Bugün Windows üzerinde çalışır ve güç kullanıcısı yazılımıdır (biraz kod okumayı bekleyin). **Aktif olarak bakımı yapılıyor ve geliştirilmeye devam edecek — ilgi olursa geliştirme sürer.** İstediğiniz şeyle birlikte bir [issue](https://github.com/SeyhmusKaya/agent-symphony/issues) açın ya da yol haritasını şekillendirmeye yardımcı olmak için [sponsor olun](https://github.com/sponsors/SeyhmusKaya).

### Ön koşullar
- **Node.js 20+**
- **Claude erişimi** — bir **Claude Pro / Max aboneliği** *ya da* bir **Anthropic API anahtarı**. Aşağıdaki [Kimlik Doğrulama](#-authentication--works-with-your-claude-plan-or-an-api-key) bölümüne bakın.
- Masaüstü derlemesi için: [Tauri ön koşulları](https://tauri.app/start/prerequisites/) (Rust araç zinciri)

### Orkestratörü çalıştırın (backend)
```bash
git clone https://github.com/SeyhmusKaya/agent-symphony.git
cd agent-symphony
npm install

# copy the secrets template and fill in what you need (optional: ssh/deploy/relay)
cp secrets.local.json.example secrets.local.json

# start the orchestrator
npm start          # or: npm run dev   (tsx watch, auto-reload)
```

### Masaüstü arayüzünü çalıştırın
```bash
cd ui
npm install
npm run tauri dev   # dev mode
# or: npm run tauri build   # produces a native desktop binary
```

### Tip kontrolü
```bash
npm run typecheck          # backend
cd ui && npm run check     # UI (svelte-check)
```

---

## 🔑 Kimlik Doğrulama — Claude planı, Anthropic anahtarı *ya da* DeepSeek anahtarı

Architect — Agent Symphony resmi **Claude Agent SDK** üzerinde çalışır ve **iki model sağlayıcısını** destekler. Bir sağlayıcıyı şu öncelik sırasıyla seçer:

- 🟣 **DeepSeek API anahtarı** *(ayarlandığında en yüksek öncelik)* — DeepSeek anahtarınızı uygulama içi **API keys** panelinden ekleyin (yerel olarak `providers.json` içinde saklanır, asla commit edilmez). Ajanlar bundan sonra DeepSeek'in Anthropic uyumlu uç noktası üzerinden **DeepSeek V4 Pro / Flash** ile çalışır. En ucuz yol; bir Claude girişiniz de varsa Claude modelleri açılır menüde kullanılabilir kalır.
- 🟢 **Claude Pro / Max aboneliği** *(Claude kullanıcıları için önerilir)* — Claude CLI ile bir kez giriş yapın (`claude login`). Kullanım mevcut **Pro/Max kotanıza sayılır — API anahtarı yok, token başına faturalama yok.**
- 🔵 **Anthropic API anahtarı** *(token başına ödeme)* — `ANTHROPIC_API_KEY` ayarlayın. Console faturalaması olan ekipler/otomasyon için en iyisi.

> ⚠️ Ortamınızda `ANTHROPIC_API_KEY` ayarlıysa, bu Claude aboneliğinizin **önüne geçer**. Claude modelleri için Pro/Max planınızı kullanmak isterseniz, o değişkeni ayarsız bırakın (ve Pro/Max hesabıyla `claude logout` → `claude login` çalıştırın). DeepSeek anahtarı uygulama içinde ayrı olarak yönetilir ve yalnızca DeepSeek model isteklerini etkiler.

Uygulamanın yerel proxy'si yalnızca prompt önbelleğini optimize eder — kimlik bilgilerinize ya da OAuth yenileme yoluna **asla dokunmaz**, böylece her iki kimlik doğrulama modu da kutudan çıktığı gibi çalışır.

---

## ⚙️ Yapılandırma

- **Kimlik Doğrulama** — bir DeepSeek anahtarı (uygulama içi), bir Claude Pro/Max girişi *ya da* `ANTHROPIC_API_KEY` (bkz. [Kimlik Doğrulama](#-authentication--claude-plan-anthropic-key-or-deepseek-key)).
- **`secrets.local.json`** — isteğe bağlı SSH / web kimlik doğrulama / relay kimlik bilgileri (git tarafından yok sayılır, asla commit edilmez). Bkz. `secrets.local.json.example`.
- **Özellik bayrakları** (ortam değişkenleri) — uzun TTL'li prompt önbelleği, asenkron görev devri ve yerel sıkıştırma gibi isteğe bağlı alt sistemleri açıp kapatın.

> `.github/`, `.team/` ve çalışma zamanı veri dizinleri git tarafından yok sayılır — hiçbir kimlik bilgisi ya da oturum verisi asla commit edilmez.

---

## 🗺️ Yol Haritası

- Platformlar arası masaüstü derlemeleri (macOS / Linux)
- ✅ Takılabilir model sağlayıcıları — **DeepSeek V4 yayınlandı**; daha fazla sağlayıcı geliyor
- Daha zengin otonom mod kontrolleri
- Daha fazla CodeGraph dili

Bir fikriniz mi var? [Bir issue açın](https://github.com/SeyhmusKaya/agent-symphony/issues) ya da işinize yarıyorsa [sponsor olmayı](https://github.com/sponsors/SeyhmusKaya) düşünün 💜.

---

## 📄 Lisans

[MIT](LICENSE) © Şeyhmus Kaya

---

<div align="center">

**Architect — Agent Symphony işinize yarıyorsa, bir ⭐ ve bir [sponsorluk](https://github.com/sponsors/SeyhmusKaya) çok şey ifade eder.**

Tek bir geliştirici tarafından özenle yapıldı ve yönetildi.

</div>
