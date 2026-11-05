// disk_cleanup.js
//
// Render'daki kalici disk (/data) dolunca Telegram listener mesaj kaydedemiyor
// ("database or disk is full" / "No space left on device") ve urunler
// yenilenmiyor. Sebep: indirilen urun gorselleri ve ham mesajlar hic
// temizlenmiyordu (import_telegram_signals.js sadece URUNE DONUSEN kayitlarin
// gorselini siliyordu).
//
// Bu betik render_start.js tarafindan acilista ve her import turundan ONCE
// calistirilir. Sirasiyla:
//   1) Eski gorselleri siler (hicbir urunun kullanmadigi ve IMAGE_MAX_AGE_HOURS
//      saatten eski olanlar). Disk doluyken bile calisabilsin diye ILK adim bu.
//   2) Gorsel klasoru IMAGE_DIR_MAX_MB'i asarsa, en eskilerden baslayarak
//      (urunlerce kullanilmayanlari) siler.
//   3) messages.db'deki RAW_MESSAGE_MAX_AGE_DAYS'ten eski ham mesajlari siler.
//
// Kullanim: node disk_cleanup.js /data/messages.db
// Ortam degiskenleri (hepsi opsiyonel):
//   TELEGRAM_IMAGES_DIR, DB_PATH, IMAGE_MAX_AGE_HOURS (30),
//   IMAGE_DIR_MAX_MB (300), RAW_MESSAGE_MAX_AGE_DAYS (7)

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const telegramDbPath = process.argv[2] || process.env.TELEGRAM_DB_PATH;
const imagesDir =
  process.env.TELEGRAM_IMAGES_DIR || path.join(__dirname, 'public', 'telegram-images');
const backendDbPath = process.env.DB_PATH || path.join(__dirname, 'firsatradar.db');

const IMAGE_MAX_AGE_HOURS = Number(process.env.IMAGE_MAX_AGE_HOURS || 30);
const IMAGE_DIR_MAX_MB = Number(process.env.IMAGE_DIR_MAX_MB || 300);
const RAW_MESSAGE_MAX_AGE_DAYS = Number(process.env.RAW_MESSAGE_MAX_AGE_DAYS || 7);

function log(msg) {
  console.log(`[disk_cleanup] ${msg}`);
}

// Hala bir urunun (ornegin aktif alarmi olan, silinmeyen urun) kullandigi
// gorselleri koru.
function referencedImageNames() {
  const names = new Set();
  if (!fs.existsSync(backendDbPath)) return names;
  let db;
  try {
    db = new Database(backendDbPath, { readonly: true, fileMustExist: true });
    for (const r of db.prepare('SELECT image_url FROM products WHERE image_url IS NOT NULL').all()) {
      const marker = '/telegram-images/';
      const idx = r.image_url.indexOf(marker);
      if (idx === -1) continue;
      try {
        names.add(decodeURIComponent(r.image_url.slice(idx + marker.length)));
      } catch {
        /* bozuk url -- yok say */
      }
    }
  } catch (e) {
    log(`Urun gorselleri okunamadi (${e.message}); gorsel temizligi ATLANDI (guvenli taraf).`);
    return null;
  } finally {
    if (db) db.close();
  }
  return names;
}

function cleanImages() {
  if (!fs.existsSync(imagesDir)) return;
  const referenced = referencedImageNames();
  if (referenced === null) return;

  const files = [];
  for (const name of fs.readdirSync(imagesDir)) {
    const full = path.join(imagesDir, name);
    try {
      const st = fs.statSync(full);
      if (st.isFile()) files.push({ name, full, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      /* dosya arada silinmis olabilir */
    }
  }

  let deleted = 0;
  let freed = 0;
  const remove = (f) => {
    try {
      fs.unlinkSync(f.full);
      deleted += 1;
      freed += f.size;
      return true;
    } catch (e) {
      if (e.code !== 'ENOENT') log(`Silinemedi (${f.name}): ${e.message}`);
      return false;
    }
  };

  // 1) Yasi dolmus ve kullanilmayan gorseller
  const cutoff = Date.now() - IMAGE_MAX_AGE_HOURS * 3600 * 1000;
  const remaining = [];
  for (const f of files) {
    if (f.mtimeMs < cutoff && !referenced.has(f.name)) {
      remove(f);
    } else {
      remaining.push(f);
    }
  }

  // 2) Hala boyut sinirini asiyorsa, kullanilmayanlari eskiden yeniye sil
  const maxBytes = IMAGE_DIR_MAX_MB * 1024 * 1024;
  let total = remaining.reduce((s, f) => s + f.size, 0);
  if (total > maxBytes) {
    const candidates = remaining.filter((f) => !referenced.has(f.name)).sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of candidates) {
      if (total <= maxBytes) break;
      if (remove(f)) total -= f.size;
    }
  }

  log(
    `Gorseller: ${files.length} dosya tarandi, ${deleted} silindi ` +
      `(${(freed / 1024 / 1024).toFixed(1)} MB bosaldi), kalan ~${(total / 1024 / 1024).toFixed(1)} MB.`
  );
}

function cleanRawMessages() {
  if (!telegramDbPath || !fs.existsSync(telegramDbPath)) return;
  let db;
  try {
    db = new Database(telegramDbPath, { fileMustExist: true });
    db.pragma('busy_timeout = 8000');
    const cutoff = new Date(Date.now() - RAW_MESSAGE_MAX_AGE_DAYS * 86400 * 1000).toISOString();
    const info = db.prepare('DELETE FROM raw_messages WHERE message_date IS NOT NULL AND message_date < ?').run(cutoff);
    log(`Ham mesajlar: ${RAW_MESSAGE_MAX_AGE_DAYS} gunden eski ${info.changes} kayit silindi.`);
  } catch (e) {
    log(`Ham mesaj temizligi basarisiz: ${e.message}`);
  } finally {
    if (db) db.close();
  }
}

try {
  cleanImages(); // once gorseller: disk doluyken DB silmesi de yer isteyebilir
} catch (e) {
  log(`Gorsel temizligi hata verdi: ${e.message}`);
}
cleanRawMessages();
