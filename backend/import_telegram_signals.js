// import_telegram_signals.js
//
// telegram_listener/ ile yakalanan mesajlari (raw_messages tablosu, ayri
// bir SQLite dosyasinda) bu backend'in products/price_history tablolarina
// aktarir.
//
// ONEMLI: Bu bir "SINYAL" aktarimidir. Telegram kanallarindan gelen fiyat/
// urun bilgisi bir TAHMINDIR (parser.py regex tabanli). Buradan gelen
// urunler source='telegram' ile isaretlenir; gercek magaza fiyatiyla
// dogrulanmadan kullanicilara "kesin fiyat" olarak sunulmamalidir --
// bkz. telegram_listener/README.md madde 6 (dogrulama katmani).
//
// Kullanim:
//   TELEGRAM_DB_PATH=/path/to/telegram_listener/data/messages.db \
//     node import_telegram_signals.js
//
// veya:
//   node import_telegram_signals.js /path/to/messages.db

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { db: backendDb, nowIso } = require('./db');
const { storeMeta } = require('./helpers');
const { sendPushNotifications } = require('./pushNotifications');

const telegramDbPath =
  process.argv[2] ||
  process.env.TELEGRAM_DB_PATH ||
  path.join(__dirname, '..', '..', 'telegram_listener', 'data', 'messages.db');

if (!fs.existsSync(telegramDbPath)) {
  console.error(`[import] Telegram DB bulunamadi: ${telegramDbPath}`);
  console.error('TELEGRAM_DB_PATH ortam degiskeni ile veya ilk argumanla yol belirtin.');
  process.exit(1);
}

const tgDb = new Database(telegramDbPath, { readonly: true });

// telegram_listener, yakaladigi urun fotograflarini dogrudan bu backend'in
// public/telegram-images/ klasorune indiriyor (bkz. telegram_listener/.env
// icindeki TG_IMAGE_DIR); server.js bu klasoru /telegram-images altinda
// servis ediyor (bkz. server.js). Burada sadece dosya adindan tam bir URL
// uretiyoruz.
//
// ONEMLI (bug fix): BACKEND_PUBLIC_URL Render'da hic set edilmemisti, bu
// yuzden asagidaki fallback devreye giriyor ve gorsel URL'leri
// "http://localhost:10000/telegram-images/..." gibi -- yani Render
// container'inin KENDI ICINDEN baska hicbir yerden (kullanicinin telefonu,
// tarayicisi) ERISILEMEYEN bir adresle -- veritabanina yaziliyordu. Bu
// yuzden uygulamada urun fotograflari hep bos/gorunmuyor cikiyordu, ama
// backend'in kendi loglarindan/curl testinden anlasilmiyordu.
//
// RENDER_EXTERNAL_URL, Render'in HER servise otomatik verdigi genel/public
// adrestir (ör. https://firsatradar-render.onrender.com) -- Render
// panelinde elle bir sey ayarlamaya GEREK KALMASIN diye once onu deniyoruz;
// BACKEND_PUBLIC_URL hala manuel override icin destekleniyor (ör. baska bir
// domain kullanilmak istenirse), en sonda ise yerel gelistirme icin
// localhost'a duser.
const BACKEND_PUBLIC_URL =
  process.env.RENDER_EXTERNAL_URL ||
  process.env.BACKEND_PUBLIC_URL ||
  `http://localhost:${process.env.PORT || 4000}`;

function imageUrlFor(imageFilename) {
  if (!imageFilename) return null;
  return `${BACKEND_PUBLIC_URL}/telegram-images/${encodeURIComponent(imageFilename)}`;
}

// shop_links icindeki domainden magaza slug'i cikar (helpers.js'teki
// STORE_META ile ayni sozlukte tutmak icin burada da tanimli).
const DOMAIN_TO_STORE = [
  [/trendyolyemek|yemek\.trendyol/i, 'trendyol-yemek'],
  [/trendyol\.com|ty\.gl/i, 'trendyol'],
  [/hepsiburada|hb\.biz/i, 'hepsiburada'],
  [/n11\.com/i, 'n11'],
  [/amazon\.com\.tr|amzn\.to/i, 'amazon'],
  [/lcwaikiki\.com/i, 'lcwaikiki'],
  [/defacto\.com\.tr/i, 'defacto'],
  [/boyner\.com\.tr/i, 'boyner'],
  [/koton\.com/i, 'koton'],
  [/ciceksepeti\.com/i, 'ciceksepeti'],
  [/morhipo\.com/i, 'morhipo'],
  [/pttavm\.com/i, 'pttavm'],
];

function guessStore(shopLinksCsv) {
  if (!shopLinksCsv) return null;
  const links = shopLinksCsv.split(',');
  for (const link of links) {
    for (const [re, store] of DOMAIN_TO_STORE) {
      if (re.test(link)) return { store, url: link };
    }
  }
  return null;
}

// Bazi kanallar (ornegin onual_firsat) magazayi TIKLANABILIR BIR LINK
// olarak degil, duz metin olarak yaziyor (ornegin "🛍️ Trendyol" satiri,
// hicbir url/buton/gizli-link olmadan). Bu durumda urunu tamamen atmak
// yerine, o magazanin arama sayfasinda urun basligiyla arama yapan bir
// link turetiyoruz -- gercek urun sayfasi DEGIL ama kullaniciyi dogru
// magazada dogru aramaya goturur.
const STORE_NAME_TO_SEARCH_URL = [
  [/trendyol/i, 'trendyol', (q) => `https://www.trendyol.com/sr?q=${encodeURIComponent(q)}`],
  [/hepsiburada/i, 'hepsiburada', (q) => `https://www.hepsiburada.com/ara?q=${encodeURIComponent(q)}`],
  [/\bn11\b/i, 'n11', (q) => `https://www.n11.com/arama?q=${encodeURIComponent(q)}`],
  [/amazon/i, 'amazon', (q) => `https://www.amazon.com.tr/s?k=${encodeURIComponent(q)}`],
  [/lc\s*waikiki/i, 'lcwaikiki', (q) => `https://www.lcwaikiki.com/tr-TR/TR/arama?q=${encodeURIComponent(q)}`],
  [/defacto/i, 'defacto', (q) => `https://www.defacto.com.tr/arama?q=${encodeURIComponent(q)}`],
  [/boyner/i, 'boyner', (q) => `https://www.boyner.com.tr/arama?q=${encodeURIComponent(q)}`],
  [/\bkoton\b/i, 'koton', (q) => `https://www.koton.com/search?q=${encodeURIComponent(q)}`],
  [/çiçeksepeti|ciceksepeti/i, 'ciceksepeti', (q) => `https://www.ciceksepeti.com/arama/${encodeURIComponent(q)}`],
  [/morhipo/i, 'morhipo', (q) => `https://www.morhipo.com/arama?q=${encodeURIComponent(q)}`],
  [/ptt\s*avm/i, 'pttavm', (q) => `https://www.pttavm.com/arama?q=${encodeURIComponent(q)}`],
];

function guessStoreFromText(rawText, title) {
  if (!rawText) return null;
  for (const [re, store, toUrl] of STORE_NAME_TO_SEARCH_URL) {
    if (re.test(rawText)) return { store, url: toUrl(title), isSearchLink: true };
  }
  return null;
}

const CATEGORY_KEYWORDS = [
  [/kulaklık|laptop|telefon|tablet|kamera|şarj|powerbank|klavye|mouse|ekran/i, 'elektronik'],
  [/ayakkabı|ceket|pantolon|elbise|kazak|çanta|gömlek|tişört/i, 'moda'],
  [/kahve|latte|yemek|menü|kahvaltı|pizza|burger/i, 'yemek'],
  [/krem|şampuan|parfüm|serum|ruj|makyaj/i, 'kozmetik'],
  [/mat|dambıl|koşu|fitness|spor|yoga/i, 'spor'],
  [/lamba|masa|koltuk|halı|mutfak|yatak/i, 'ev-yasam'],
];

function guessCategory(title) {
  if (!title) return 'diger';
  for (const [re, cat] of CATEGORY_KEYWORDS) {
    if (re.test(title)) return cat;
  }
  return 'diger';
}

// Mesajda "%45 indirim" gibi bir yuzde geciyor ama gercek eski fiyat metinde
// yoksa (parser.py bu ikisini ayri ayri yakalar), o yuzdeden GERIYE DOGRU
// bir "eski fiyat" turetiyoruz -- boylece urun ilk eklendigi anda bile
// indirim rozeti/uzeri cizili eski fiyat gosterilebilir. Bu turetilmis
// deger gercek magaza fiyati DEGIL, sadece mesajdaki yuzdeye dayali bir
// tahmindir; urun tekrar yakalanip gercek fiyat degisimi gozlendiginde
// (bkz. asagidaki priceChanged mantigi) gercek gozlemle degistirilir.
function impliedOldPrice(priceAmount, discountPercent) {
  if (priceAmount == null || discountPercent == null) return null;
  if (discountPercent <= 0 || discountPercent >= 100) return null;
  const old = priceAmount / (1 - discountPercent / 100);
  return Math.round(old * 100) / 100;
}

// Bu script periyodik calistirilmak uzere tasarlandi (ornegin bir cron ile
// telegram_listener'in yaninda). Her calistirmada TUM raw_messages
// tablosunu yeniden islemek hem yavas hem de fiyati degismemis mesajlar
// icin gereksiz price_history noktalari uretir -- bu yuzden son islenen
// satirin id'sini backend DB'sinde saklıyoruz ve sadece ondan sonrakileri
// isliyoruz.
backendDb.exec(`
  CREATE TABLE IF NOT EXISTS import_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);
const STATE_KEY = 'telegram_last_raw_message_id';
const stateRow = backendDb.prepare('SELECT value FROM import_state WHERE key = ?').get(STATE_KEY);
const lastId = stateRow ? parseInt(stateRow.value, 10) : 0;

const rows = tgDb
  .prepare(
    `SELECT id, channel, message_id, message_date, product_guess, price_amount,
            discount_percent, shop_links, raw_text, image_filename
     FROM raw_messages
     WHERE id > ? AND looks_like_offer = 1
       AND product_guess IS NOT NULL AND price_amount IS NOT NULL
     ORDER BY id ASC`
  )
  .all(lastId);

console.log(`[import] Son islenen id: ${lastId}. ${rows.length} yeni aday firsat mesaji bulundu.`);

const findExisting = backendDb.prepare(
  `SELECT * FROM products WHERE source = 'telegram' AND store = ? AND lower(title) = lower(?)`
);
const insertProduct = backendDb.prepare(`
  INSERT INTO products
    (title, category, store, store_url, image_url, current_price, old_price, currency,
     stock_status, follow_count, verified_at, source, created_at, updated_at)
  VALUES
    (@title, @category, @store, @store_url, @image_url, @current_price, @old_price, 'TRY',
     'in_stock', 0, @verified_at, 'telegram', @created_at, @updated_at)
`);
const updateProduct = backendDb.prepare(`
  UPDATE products SET
    current_price = @current_price,
    old_price = CASE WHEN @old_price IS NOT NULL THEN @old_price ELSE old_price END,
    image_url = CASE WHEN @image_url IS NOT NULL THEN @image_url ELSE image_url END,
    store_url = @store_url,
    verified_at = @verified_at,
    updated_at = @updated_at
  WHERE id = @id
`);
const insertHistory = backendDb.prepare(
  `INSERT INTO price_history (product_id, price, checked_at) VALUES (?, ?, ?)`
);

// --- Push bildirimi hook noktalari --------------------------------------
// Transaction TAMAMEN senkron olmak zorunda (better-sqlite3), bu yuzden
// burada sadece hangi bildirimlerin gonderilecegine dair PLAIN DATA
// topluyoruz (pendingNotifications) -- gercek gonderim (async HTTP) ancak
// runAll() bittikten SONRA yapiliyor (bkz. dosyanin sonu).
const findAlarmsForProduct = backendDb.prepare(
  `SELECT * FROM alarms WHERE product_id = ? AND active = 1 AND target_price IS NOT NULL`
);
const markAlarmNotified = backendDb.prepare('UPDATE alarms SET notified_at = ? WHERE id = ?');
const resetAlarmNotified = backendDb.prepare('UPDATE alarms SET notified_at = NULL WHERE id = ?');
const findActivePreferences = backendDb.prepare(
  `SELECT * FROM user_preferences WHERE notifications_enabled = 1`
);
const findPushTokensByUser = backendDb.prepare('SELECT token FROM push_tokens WHERE user_id = ?');
const findPushTokensByDevice = backendDb.prepare(
  'SELECT token FROM push_tokens WHERE device_id = ? AND user_id IS NULL'
);

function tokensForOwner({ userId, deviceId }) {
  const rows = userId != null ? findPushTokensByUser.all(userId) : findPushTokensByDevice.all(deviceId);
  return rows.map((r) => r.token);
}

const pendingNotifications = [];

// Fiyat degisen (mevcut) bir urun icin: hedefin altina YENI dusen aktif
// alarmlari bul, bildirim biriktir ve notified_at'i isaretle. Fiyat tekrar
// hedefin ustune cikarsa notified_at'i sifirlar (bir sonraki dususte
// tekrar bildirim gitsin diye) -- boylece 5 dakikada bir tekrar tekrar
// bildirim gitmez.
function collectAlarmNotifications(product, newPrice) {
  const alarms = findAlarmsForProduct.all(product.id);
  for (const alarm of alarms) {
    if (newPrice <= alarm.target_price) {
      if (!alarm.notified_at) {
        const tokens = tokensForOwner({ userId: alarm.user_id, deviceId: alarm.device_id });
        for (const token of tokens) {
          pendingNotifications.push({
            to: token,
            title: 'Hedeflediğin fiyata ulaşıldı 🎯',
            body: `${product.title} şimdi ₺${Math.round(newPrice).toLocaleString('tr-TR')}`,
            data: { type: 'alarm', productId: product.id },
          });
        }
        markAlarmNotified.run(nowIso(), alarm.id);
      }
    } else if (alarm.notified_at) {
      resetAlarmNotified.run(alarm.id);
    }
  }
}

// Yeni eklenen bir urun icin: bu magazayi/kategoriyi tercih eden ve
// bildirimleri acik olan kullanicilari bul, bildirim biriktir.
function collectNewProductNotifications(productId, title, store, category) {
  const meta = storeMeta(store);
  for (const pref of findActivePreferences.all()) {
    let stores = [];
    let categories = [];
    try {
      stores = JSON.parse(pref.stores || '[]');
    } catch {
      stores = [];
    }
    try {
      categories = JSON.parse(pref.categories || '[]');
    } catch {
      categories = [];
    }
    if (!stores.includes(store) && !categories.includes(category)) continue;

    const tokens = tokensForOwner({ userId: pref.user_id, deviceId: pref.device_id });
    for (const token of tokens) {
      pendingNotifications.push({
        to: token,
        title: 'Yeni fırsat radarda 📡',
        body: `${title} · ${meta.label}`,
        data: { type: 'new_product', productId },
      });
    }
  }
}

let created = 0;
let updated = 0;
let skipped = 0;
let searchLinkCount = 0;

const runAll = backendDb.transaction(() => {
  for (const row of rows) {
    const title = row.product_guess.trim();

    // Once gercek/tiklanabilir bir magaza linki dene; yoksa mesaj
    // metninde duz yazili bir magaza adi var mi diye bak (ornegin
    // "🛍️ Trendyol") -- varsa o magazada bir arama linki uret.
    const storeInfo = guessStore(row.shop_links) || guessStoreFromText(row.raw_text, title);
    if (!storeInfo) {
      skipped += 1;
      continue; // ne link ne de taninan bir magaza adi var -- atla
    }
    if (storeInfo.isSearchLink) searchLinkCount += 1;

    const category = guessCategory(title);
    const checkedAt = row.message_date || nowIso();

    const existing = findExisting.get(storeInfo.store, title);
    const imageUrl = imageUrlFor(row.image_filename);

    if (existing) {
      const priceChanged = existing.current_price !== row.price_amount;
      // Fiyat degistiyse eski fiyati "old_price" referansi olarak sakla,
      // yeni fiyati guncelle ve gecmise bir nokta ekle. Fiyat ayniysa
      // sadece "dogrulama zamani"ni tazele, gereksiz gecmis noktasi ekleme.
      updateProduct.run({
        id: existing.id,
        current_price: row.price_amount,
        old_price: priceChanged
          ? existing.current_price
          // Fiyat degismedi ama hala eski fiyatimiz yoksa, bu mesajdaki
          // indirim yuzdesinden bir tahmin dolduralim (varsa).
          : existing.old_price == null
          ? impliedOldPrice(row.price_amount, row.discount_percent)
          : null,
        image_url: imageUrl,
        store_url: storeInfo.url,
        verified_at: nowIso(),
        updated_at: nowIso(),
      });
      if (priceChanged) {
        insertHistory.run(existing.id, row.price_amount, checkedAt);
        collectAlarmNotifications(existing, row.price_amount);
      }
      updated += 1;
    } else {
      const info = insertProduct.run({
        title,
        category,
        store: storeInfo.store,
        store_url: storeInfo.url,
        image_url: imageUrl,
        current_price: row.price_amount,
        old_price: impliedOldPrice(row.price_amount, row.discount_percent),
        verified_at: nowIso(),
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      insertHistory.run(info.lastInsertRowid, row.price_amount, checkedAt);
      collectNewProductNotifications(info.lastInsertRowid, title, storeInfo.store, category);
      created += 1;
    }
  }

  if (rows.length > 0) {
    const newLastId = rows[rows.length - 1].id;
    backendDb
      .prepare(
        `INSERT INTO import_state (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(STATE_KEY, String(newLastId));
  }
});

runAll();

console.log(`[import] Tamam. Yeni: ${created}, guncellenen: ${updated}, atlanan (magaza taninamadi): ${skipped}`);
if (searchLinkCount > 0) {
  console.log(
    `[import] Not: ${searchLinkCount} urunde mesajda tiklanabilir link yoktu -- ` +
      "magazanin arama sayfasina yonlendiren bir link uretildi (tam urun sayfasi degil)."
  );
}
console.log(
  "[import] Not: source='telegram' urunlerin old_price'i genelde bos gelir " +
    '(ilk gorulen fiyat referans yok); zaman icinde ayni urun tekrar ' +
    'yakalanip fiyati degistikce old_price/discount otomatik olusur.'
);

// Transaction bittikten SONRA, biriken push bildirimlerini gonder --
// asagidaki hicbir hata bu scriptin exit code'unu etkilemez/import'u
// gecersiz kilmaz (bildirim gonderimi yardimci bir adim, ana is degil).
if (pendingNotifications.length > 0) {
  console.log(`[import] ${pendingNotifications.length} push bildirimi gonderiliyor...`);
  sendPushNotifications(pendingNotifications)
    .then(({ sent, removed }) => {
      console.log(`[import] Push bildirimleri tamam. Gonderilen: ${sent}, gecersiz/temizlenen jeton: ${removed}`);
    })
    .catch((e) => {
      console.error('[import] Push bildirimleri gonderilirken hata:', e.message);
    });
}
