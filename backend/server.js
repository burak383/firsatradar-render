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
const { renderPrivacyPolicy, renderAccountDeletionPage } = require('./legalPages');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'firsatradar-backend' }));

// Google Play / App Store yayin formlarindaki "Gizlilik politikasi URL'si"
// alani icin -- giris gerektirmeyen, herkese acik bir sayfa olmali (bkz.
// legalPages.js).
app.get('/privacy', renderPrivacyPolicy);

// Google Play'in "Hesap silme URL'si" (Data safety) alani icin -- gercek,
// kendi-kendine-hizmet bir silme formu (bkz. legalPages.js).
app.get('/hesap-silme', renderAccountDeletionPage);

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
