require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

require('./db'); // baglanti + sema + seed (ilk calistirmada)

const dealsRouter = require('./routes/deals');
const categoriesRouter = require('./routes/categories');
const searchRouter = require('./routes/search');
const alarmsRouter = require('./routes/alarms');
const authRouter = require('./routes/auth');
const preferencesRouter = require('./routes/preferences');
const pushTokensRouter = require('./routes/push-tokens');
const { renderPrivacyPolicy, renderAccountDeletionPage, renderSupportPage } = require('./legalPages');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'firsatradar-backend' }));

// AdMob uygulama dogrulamasi (app-ads.txt): dosya, Google Play'deki "gelistirici
// web sitesi" alaninda yazan alan adinin KOKUNDE yayinlanmali. Icerik AdMob
// konsolunun verdigi satirin aynisidir.
app.get('/app-ads.txt', (req, res) => {
  res
    .type('text/plain; charset=utf-8')
    .set('Cache-Control', 'public, max-age=3600')
    .send('google.com, pub-9017194698663463, DIRECT, f08c47fec0942fa0\n');
});

// Gelistirici web sitesi olarak gosterilen basit acilis sayfasi (Play Store ve
// AdMob "gelistirici web sitesi" alani). Giris gerektirmez.
const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.firsatradar.app';
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FırsatRadar: İndirim Takibi</title>
<meta name="description" content="Fiyat alarmı, fiyat geçmişi ve günün indirimleri tek yerde. Fırsatı kaçırma.">
<style>
  body{margin:0;background:#0B0F17;color:#F4F7FB;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.6}
  main{max-width:640px;margin:0 auto;padding:48px 20px}
  h1{font-size:32px;margin:0 0 8px}
  p{color:#9AA8BB}
  a.btn{display:inline-block;margin:16px 0;padding:14px 22px;background:#FF6B00;color:#0B0F17;font-weight:700;border-radius:14px;text-decoration:none}
  nav a{color:#72F3A1;margin-right:16px}
</style>
</head>
<body>
<main>
  <h1>FırsatRadar</h1>
  <p>Trendyol, Hepsiburada, N11, Amazon ve Çiçeksepeti gibi mağazalardaki indirimleri tek yerde gör, fiyat geçmişine bak, hedef fiyatına düşünce bildirim al.</p>
  <a class="btn" href="${PLAY_URL}">Google Play'den indir</a>
  <nav>
    <a href="/privacy">Gizlilik Politikası</a>
    <a href="/destek">Destek</a>
    <a href="/hesap-silme">Hesap Silme</a>
  </nav>
  <p style="font-size:13px">FırsatRadar bağımsız bir uygulamadır; adı geçen mağazalarla bağlantılı değildir. Fiyatlar otomatik toplanır ve hatalı olabilir.</p>
</main>
</body>
</html>`);
});

// Google Play / App Store yayin formlarindaki "Gizlilik politikasi URL'si"
// alani icin -- giris gerektirmeyen, herkese acik bir sayfa olmali (bkz.
// legalPages.js).
app.get('/privacy', renderPrivacyPolicy);

// Google Play'in "Hesap silme URL'si" (Data safety) alani icin -- gercek,
// kendi-kendine-hizmet bir silme formu (bkz. legalPages.js).
app.get('/hesap-silme', renderAccountDeletionPage);

// App Store Connect'in "Support URL" alani icin -- giris gerektirmeyen,
// herkese acik bir SSS/iletisim sayfasi (bkz. legalPages.js).
app.get('/destek', renderSupportPage);

// telegram_listener'in indirdigi urun fotograflarini servis eder --
// import_telegram_signals.js bu klasordeki dosyalara
// http://.../telegram-images/<dosya> seklinde URL uretir.
//
// ONEMLI: bu, gorseller HIC YUKLENMEDEN once burada
// path.join(__dirname, 'public', 'telegram-images') OLARAK SABITLENMISTI --
// oysa Render'da render_start.js, Python listener'a gorselleri KALICI
// DISKE (TG_IMAGE_DIR=/data/telegram-images, bkz. render_start.js)
// indirmesini soyluyor. Yani listener dosyalari /data/telegram-images'e
// yaziyordu, ama bu route hep /app/backend/public/telegram-images
// (container icinde HER DEPLOY'DA sifirlanan, gorseli hicbir zaman
// icermeyen bir klasor) altina bakiyordu -- sonuc: HER telegram gorseli
// 404 donuyordu. Simdi ayni TELEGRAM_IMAGES_DIR ortam degiskenini
// kullanarak listener'in yazdigi klasorun AYNISINI servis ediyoruz;
// degisken tanimli degilse (ornegin yerel Windows kurulumunda) eskisi
// gibi backend/public/telegram-images'e duser.
const TELEGRAM_IMAGES_DIR =
  process.env.TELEGRAM_IMAGES_DIR || path.join(__dirname, 'public', 'telegram-images');
app.use('/telegram-images', express.static(TELEGRAM_IMAGES_DIR));

app.use('/api/deals', dealsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/search', searchRouter);
app.use('/api/alarms', alarmsRouter);
app.use('/api/auth', authRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/push-tokens', pushTokensRouter);

app.use((req, res) => res.status(404).json({ error: 'Bulunamadi' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatasi' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`[firsatradar-backend] http://localhost:${PORT}`);
});
