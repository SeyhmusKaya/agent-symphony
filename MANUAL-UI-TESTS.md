# Architect — Manuel UI Test Listesi (ortak oturum)

Bu liste, uygulama **calisirken** sahip + Claude'un birlikte adim adim yurutecegi
gorsel/UI kontrolleridir. Otomatik (headless) testler `scripts/tests/` altinda;
buradakiler **UI gorseli, mid-tur yeniden-derleme veya canli izleme** gerektirdigi
icin otomatiklestirilemedi.

**Test projeleri:**
- **EmlakCopilot** (sef / chief) — port 4318. Asil kod-arama + sef davranis testleri.
- **Mimar** (koordinator) — port 4316. Header tutarlilik + cok-proje kontrolleri.

Her adim: **Yap / Beklenen / PASS-FAIL**. Sirayla ilerle. Token harcayan adimlar
"[TOKEN]" ile isaretli.

---

## 0. Hazirlik

- [ ] Architect uygulamasi acik, EmlakCopilot ve Mimar projeleri gorunuyor.
- [ ] EmlakCopilot orkestratoru ayakta (port 4318), Mimar ayakta (port 4316).
- [ ] (Token olcumu icin) EmlakCopilot sef oturumu temiz/yeni — header'da Session $ sifira yakin.

---

## 1. CodeGraph aramada kullaniliyor (Fix 122 — soft prompt) [TOKEN]

**Yap:** EmlakCopilot sefine tool BELIRTMEDEN sor:
> "Projede login/auth ana fonksiyonu hangi dosyada? En ekonomik yolla bul."

**Beklenen:**
- Inline tool kartlarinda ILK arama kartı `code_search` (veya `code_*`/`search_docs`,
  yani `mcp__architect__...`) olmali — **Grep/Bash DEGIL**.
- Grep/Bash cikabilir ama codegraph'tan SONRA, sadece bosluk doldurmak icin.

**PASS-FAIL:** [ ] PASS  [ ] FAIL — ilk arama kartinin adi: ____________________

---

## 2. Grep engellenmiyor (Fix 122 — hard-deny kalkti) [TOKEN]

**Yap:** EmlakCopilot sefine ACIK soyle:
> "DOGRUDAN Grep ile kaynakta 'function' ara, CodeGraph kullanma."

**Beklenen:**
- Grep tool kartı calisip **sonuc** doner.
- Hicbir kartta "[KOD ARAMA YASAK]" / "reddedildi" hata metni cikmaz.
- Tur normal tamamlanir (sef_cevap).

**PASS-FAIL:** [ ] PASS  [ ] FAIL — gozlenen hata (varsa): ____________________

---

## 3. Durdur butonu GERCEKTEN durduruyor (Fix 120 CORE A) [TOKEN]

**Yap:** EmlakCopilot sefine cok-adimli uzun bir komut ver (orn. "dosyalari listele,
en buyuk 3 dosyayi ozetle, bagimlilik haritasi cikar — adim adim"). Sef calismaya
baslayip ilk tool kartını gosterdikten ~5-6sn sonra **Durdur** butonuna bas.

**Beklenen:**
- Durdurdan sonra YENI metin akmaz (streamed delta durur).
- Yeni "calisiyor" tool kartı acilmaz.
- UI "durduruldu/idle" durumuna gecer; takili spinner kalmaz.

**PASS-FAIL:** [ ] PASS  [ ] FAIL — durdurdan sonra akan sey (varsa): ____________________

---

## 4. Duraklat + Devam ayni oturumda surer (paralel cift-kosu yok) [TOKEN]

**Yap:** Uzun bir komut baslat. Ortasinda **Duraklat**'a bas, birkac saniye bekle,
sonra **Devam**'a bas.

**Beklenen:**
- Devam'dan sonra AYNI tur kaldigi yerden surer.
- Iki paralel tur calismaz (token sayaci ciftlenmiyor, kartlar kopyalanmiyor).
- Hafiza korunur (devam eden tur baslangictaki baglami biliyor).

**PASS-FAIL:** [ ] PASS  [ ] FAIL — gozlem: ____________________

---

## 5. Kosu sirasinda/sonrasinda YENI mesaj paralel kosu acmaz (Fix 120 CORE B) [TOKEN]

**Yap:**
1. Bir komut baslat (sef calisiyorken).
2. Sef hala calisirken sohbet kutusuna YENI bir mesaj yaz ve gonder.
3. Ayrica: bir tur biter bitmez hemen ikinci bir mesaj gonder.

**Beklenen:**
- Yeni mesaj **kuyruga alinir veya mevcut turu izler** — IKINCI bir paralel sef turu
  baslamaz (cift token akisi / cift aktivite kartı yok).
- Sefin tek bir aktif turu olur; UI tek akis gosterir.

**PASS-FAIL:** [ ] PASS  [ ] FAIL — paralel kosu gorundu mu: ____________________

---

## 6. Yarim tur mid-tur yeniden-derlemeden sagkalir (Fix 121) [TOKEN]

**Yap:**
1. EmlakCopilot sefine uzunca surecek bir komut ver; sef metin akitmaya/tool
   calistirmaya baslasin (tur ORTASINDA).
2. Tur bitmeden orkestratoru **sert kapat / yeniden-derle** (dev: tsx watch tetikleyen
   bir kaynak degisikligi veya process kill -> restart).
3. Uygulama/sef geri gelince ayni oturumun sohbetine bak.

**Beklenen:**
- Yarim kalan tur **kaybolmaz**; sohbet gecmisinde `incomplete` bir kayit olarak
  durur ve UI'da **"[Yarim — kesildi]"** benzeri bir isaretle gosterilir.
- (Dosya teyidi, istege bagli: `EmlakCopilot/.team/sessions/<activeId>/chat.json`
  icinde son ChatEntry'de `incomplete`/`_live` izi.)

**PASS-FAIL:** [ ] PASS  [ ] FAIL — gosterilen etiket: ____________________

---

## 7. Header'da Session $ / $-saat her projede tutarli (Fix 119)

**Yap:** Sirayla EmlakCopilot, Mimar ve (varsa) "google yorum" projelerine gec.
Hicbir harcama olmayan yeni/temiz bir projeye de bak.

**Beklenen:**
- Her projede header'da **Session $** ve **$-saat** (saatlik) alanlari ayni
  formatta gorunur.
- Sifir-harcamali projede de alan KAYBOLMAZ; `$0.00` / `$0.00/sa` gosterir
  (bos/NaN/--- degil).

**PASS-FAIL:** [ ] PASS  [ ] FAIL — tutarsiz olan proje (varsa): ____________________

---

## 8. Uzun dusunme/tool beklemesinde sahte "Baglanti zaman asimi" yok (watchdog) [TOKEN]

**Yap:** Uzun surecek bir gorev ver (cok tool'lu veya uzun model dusunmesi).
Sef 30-60sn+ tek tool/dusunmede beklerken UI'yi izle.

**Beklenen:**
- "Baglanti zaman asimi" / "Bağlantı zaman aşımı" uyarisi YANLIS yere CIKMAZ.
- WS canli (token sayaci ara ara guncellenir, spinner doner), watchdog sef
  gercekten calisirken alarm vermez.

**PASS-FAIL:** [ ] PASS  [ ] FAIL — sahte alarm cikti mi: ____________________

---

## 9. Fast mode toggle [TOKEN]

**Yap:** Fast mode'u ac, kisa bir komut calistir; sonra kapat, ayni komutu tekrar calistir.

**Beklenen:**
- Toggle UI'da durumunu net gosterir (acik/kapali).
- Fast mode acikken davranis beklendigi gibi degisir (daha az tur/dusuk effort vb.),
  kapaliyken normale doner. Toggle yarida kalmaz, hata vermez.

**PASS-FAIL:** [ ] PASS  [ ] FAIL — gozlem: ____________________

---

## 10. Model badge tum projelerde tutarli (Fix 118)

**Yap:** EmlakCopilot ve Mimar'da uzman/ajan listesine bak; model rozetlerini incele.

**Beklenen:**
- Rozetler TAM slug gosterir (orn. `claude-sonnet-4-6`), ciplak `sonnet`/`opus`/`haiku`
  YOK.
- Ayni model her projede ayni rozetle gorunur (tutarli isimlendirme).
- (Teyit: `t05_static_checks.mjs` agents.json'da bunu zaten dogruluyor — UI rozetiyle esles.)

**PASS-FAIL:** [ ] PASS  [ ] FAIL — ciplak/tutarsiz rozet (varsa): ____________________

---

## 11. Subagent (Agent tool) uzun kosuda canli ilerleme gosterir (#123) [TOKEN]

**Yap:** Sefe, bir uzmani/subagent'i (Agent tool) cagiracak ve uzun surecek bir gorev
ver (orn. "backend uzmanini cagir, X modulunu bastan analiz et").

**Beklenen:**
- Subagent calisirken UI **canli ilerleme** gosterir (alt-aktivite/tool kartlari veya
  akan ozet) — sadece opak "Thinking..." / sabit spinner DEGIL.
- Subagent bitince sonucu nete dolar.

**PASS-FAIL:** [ ] PASS  [ ] FAIL — gozlenen: opak mi / canli mi: ____________________

---

## 12. Token izleme — cold-start in-token karsilastirmasi (Fix 124) [TOKEN]

**Yap:**
1. EmlakCopilot sef oturumunu temizle/yenile (cold).
2. Tek kisa komut gonder (orn. "Bu proje ne ise yarar? Tek cumle.").
3. Header / token panelinde **liveIn** (yeni girdi token) degerine bak.
   (Istege bagli ayni anda: `node scripts/tests/t04_token_baseline.mjs 4318`.)

**Beklenen:**
- Cold-start liveIn **eskisinden cok dusuk** (eski referans ~22k token cold).
- cacheRead makul, cacheCreate patlamasi yok.

**Olculen liveIn:** ____________  **Onceki referans:** ~22k  **Daha mi dusuk?** [ ] EVET  [ ] HAYIR

**PASS-FAIL:** [ ] PASS  [ ] FAIL

---

## Ozet

| # | Test | Fix | PASS/FAIL |
|---|------|-----|-----------|
| 1 | CodeGraph aramada kullaniliyor | 122 | |
| 2 | Grep engellenmiyor | 122 | |
| 3 | Durdur gercekten durduruyor | 120-A | |
| 4 | Duraklat+Devam ayni oturum | 120 | |
| 5 | Yeni mesaj paralel kosu acmaz | 120-B | |
| 6 | Yarim tur yeniden-derlemeden sagkalir | 121 | |
| 7 | Header Session $/$-saat tutarli | 119 | |
| 8 | Sahte baglanti zaman asimi yok | watchdog | |
| 9 | Fast mode toggle | fast | |
| 10 | Model badge tutarli | 118 | |
| 11 | Subagent canli ilerleme | #123 | |
| 12 | Cold-start token dustu | 124 | |
