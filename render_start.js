// render_start.js
//
// Render.com'da TEK bir "Web Service" icinde backend + Telegram listener +
// periyodik import calistiran surec yoneticisi.
//
// ONEMLI: Bu dosya SADECE Render deploy'u icindir. Windows'taki yerel
// kurulumu (start_backend.bat / start_listener.bat / run_import.bat,
// Gorev Zamanlayicisi) hicbir sekilde etkilemez/degistirmez -- o ayri,
// bagimsiz bir kurulum olarak calismaya devam eder.
//
// Render'da bu dosya "node render_start.js" olarak baslatilir (bkz.
// Dockerfile CMD). Sirasiyla:
//   1) Backend'i (Express) AYNI process icinde baslatir.
//   2) Telegram listener'i (Python) ayri bir alt surec olarak baslatir,
//      coker/cikarsa otomatik yeniden baslatir.
//   3) Telegram->backend import'unu periyodik (varsayilan 5 dk) olarak
//      ayri bir alt surec olarak calistirir.
//
// Tum kalici veri (SQLite dosyalari, Telegram oturum dosyasi, urun
// gorselleri) Render'in kalici diskinin baglandigi klasore (varsayilan
// /data) yaziliyor -- boylece redeploy/restart sonrasi hicbir sey
// kaybolmaz.

const path = require('path');
const { spawn } = require('child_process');

const DATA_DIR = process.env.RENDER_DISK_PATH || '/data';
const IMPORT_INTERVAL_MS = Number(process.env.IMPORT_INTERVAL_MS || 5 * 60 * 1000);

function log(msg) {
  console.log(`[render_start] ${msg}`);
}

// --- 1) Backend'i baslat -----------------------------------------------
// server.js modul yuklenince kendi kendine app.listen() cagiriyor, bu
// yuzden require etmek baslatmaya yeter. DB_PATH ve TELEGRAM_IMAGES_DIR'i
// kalici diske yonlendiriyoruz.
process.env.DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'firsatradar.db');
process.env.TELEGRAM_IMAGES_DIR =
  process.env.TELEGRAM_IMAGES_DIR || path.join(DATA_DIR, 'telegram-images');
log(`Backend baslatiliyor (DB_PATH=${process.env.DB_PATH})`);
require('./backend/server.js');

// --- 2) Telegram listener'i alt surec olarak baslat ---------------------
const TELEGRAM_DB_PATH = path.join(DATA_DIR, 'messages.db');
const listenerEnv = {
  ...process.env,
  DB_PATH: TELEGRAM_DB_PATH,
  TG_IMAGE_DIR: process.env.TELEGRAM_IMAGES_DIR,
  // Oturum dosyasi (.session) da kalici diskte olmali -- kaybolursa
  // Telegram'a tekrar interaktif giris gerekir ki headless bir sunucuda
  // bu mumkun degil. bkz. asagidaki "ONEMLI: ilk kurulum" notu.
  TG_SESSION_NAME: path.join(DATA_DIR, 'firsatradar_watcher'),
};

let listenerRestarts = 0;

function startListener() {
  log('Telegram listener baslatiliyor...');
  const proc = spawn('python3', ['-u', 'listener.py'], {
    cwd: path.join(__dirname, 'telegram_listener'),
    env: listenerEnv,
    stdio: 'inherit',
  });
  proc.on('exit', (code, signal) => {
    listenerRestarts += 1;
    log(`Listener durdu (kod=${code}, sinyal=${signal}). ${listenerRestarts}. yeniden baslatma, 15 sn sonra...`);
    setTimeout(startListener, 15000);
  });
  proc.on('error', (err) => {
    log(`Listener baslatilamadi -- ${err.message}`);
  });
}
startListener();

// --- 3) Import'u periyodik calistir -------------------------------------
function runImportOnce() {
  log('Telegram -> backend import calisiyor...');
  const proc = spawn('node', ['import_telegram_signals.js', TELEGRAM_DB_PATH], {
    cwd: path.join(__dirname, 'backend'),
    env: { ...process.env, DB_PATH: process.env.DB_PATH },
    stdio: 'inherit',
  });
  proc.on('exit', (code) => {
    if (code !== 0) log(`Import basarisiz bitti (kod=${code})`);
  });
}
// Backend + listener'in tam ayaga kalkmasi icin ilk import'u biraz
// geciktiriyoruz, sonrasinda duzenli araliklarla tekrarliyoruz.
setTimeout(runImportOnce, 30000);
setInterval(runImportOnce, IMPORT_INTERVAL_MS);

process.on('SIGTERM', () => {
  log('SIGTERM alindi, kapatiliyor...');
  process.exit(0);
});
