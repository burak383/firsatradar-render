require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');

require('./db'); // baglanti + sema + seed (ilk calistirmada)

const dealsRouter = require('./routes/deals');
const categoriesRouter = require('./routes/categories');
const searchRouter = require('./routes/search');
const alarmsRouter = require('./routes/alarms');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'firsatradar-backend' }));

// telegram_listener'in indirdigi urun fotograflarini servis eder --
// import_telegram_signals.js bu klasordeki dosyalara
// http://.../telegram-images/<dosya> seklinde URL uretir.
// TELEGRAM_IMAGES_DIR ortam degiskeni verilmezse (yerel Windows kurulumu
// gibi) varsayilan olarak backend/public/telegram-images kullanilir;
// Render'da render_start.js bunu kalici diskteki bir klasore yonlendirir.
const TELEGRAM_IMAGES_DIR =
  process.env.TELEGRAM_IMAGES_DIR || path.join(__dirname, 'public', 'telegram-images');
app.use('/telegram-images', express.static(TELEGRAM_IMAGES_DIR));

// TEK SEFERLIK kurulum yardimcisi: Windows'ta zaten olusturulmus Telegram
// oturum dosyasini (.session) Render'in kalici diskine tasimak icin.
// Telegram'a headless bir sunucuda interaktif giris yapmak (telefon/SMS
// kodu) mumkun olmadigindan, zaten dogrulanmis oturumu buraya kopyalamak
// en pratik yol. SADECE ADMIN_UPLOAD_TOKEN ortam degiskeni tanimliysa
// (yani sadece Render'da, ve sen elle sildikten sonra kapanir) aktif olur
// -- yerel Windows kurulumunda bu degisken olmadigi icin route hic
// olusmaz. Kullanildiktan sonra ADMIN_UPLOAD_TOKEN'i Render panelinden
// silmen/degistirmen onerilir.
const ADMIN_UPLOAD_TOKEN = process.env.ADMIN_UPLOAD_TOKEN;
if (ADMIN_UPLOAD_TOKEN) {
  const DATA_DIR = process.env.RENDER_DISK_PATH || '/data';
  app.post('/admin/upload-session', express.raw({ type: '*/*', limit: '5mb' }), (req, res) => {
    if (req.query.token !== ADMIN_UPLOAD_TOKEN) {
      return res.status(403).json({ error: 'Yetkisiz' });
    }
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'Bos govde -- dosya gelmedi' });
    }
    const dest = path.join(DATA_DIR, 'firsatradar_watcher.session');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(dest, req.body);
    console.log(`[admin] Session dosyasi yazildi: ${dest} (${req.body.length} bayt)`);
    res.json({ ok: true, bytes: req.body.length, path: dest });
  });
}

app.use('/api/deals', dealsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/search', searchRouter);
app.use('/api/alarms', alarmsRouter);

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
