// db.js
// SQLite baglantisi, sema ve (ilk calistirmada) seed data.
//
// Notlar:
// - Basit tutmak icin better-sqlite3 (senkron) kullaniliyor.
// - "follow_count" alani GERCEK alarm/abonelik sayisi DEGIL; ekranlardaki
//   "2.418 kisi takip ediyor" gibi sosyal-kanit metrikleri icin ayri
//   tutuldu. Gercek fiyat alarmlari `alarms` tablosunda.
// - group_slug: ayni urunun farkli magazalardaki fiyatlarini
//   karsilastirmak icin (Arama ekranindaki "magaza karsilastirmasi").
//   Ayni urun/farkli magaza satirlari ayni group_slug'i paylasir.

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'firsatradar.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_slug TEXT,
  title TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL,
  store TEXT NOT NULL,
  store_url TEXT NOT NULL,
  image_url TEXT,
  current_price REAL NOT NULL,
  old_price REAL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  stock_status TEXT NOT NULL DEFAULT 'in_stock',
  is_flash_deal INTEGER NOT NULL DEFAULT 0,
  flash_deal_ends_at TEXT,
  coupon_code TEXT,
  follow_count INTEGER NOT NULL DEFAULT 0,
  verified_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alarms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL DEFAULT 'demo-device',
  target_price REAL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- Gercek hesap sistemi (e-posta + sifre giris/kayit -- bkz. routes/auth.js).
-- Alarmlar onceden sadece cihaz kimligiyle (device_id) tutuluyordu; artik
-- bir kullanici hesabina da baglanabiliyor (bkz. asagidaki alarms.user_id
-- migration'i).
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Profil ekranindaki "Tercihler" (takip edilen pazaryerleri, ilgi alani
-- kategorileri, anlik bildirim tercihi) -- bkz. routes/preferences.js.
-- Alarmlar ile ayni desen: giris yapmamis kullanicida device_id ile,
-- giris yapmista user_id ile calisir; misafirken ayarlanmis tercihler
-- hesaba giris yapilinca o hesaba devredilir.
CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT,
  user_id INTEGER REFERENCES users(id),
  stores TEXT NOT NULL DEFAULT '[]',
  categories TEXT NOT NULL DEFAULT '[]',
  notifications_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_prefs_user_unique ON user_preferences(user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_prefs_device_unique ON user_preferences(device_id) WHERE user_id IS NULL;

-- Push bildirimi jetonlari (Expo push token). Bir cihaz/kurulum tek bir
-- token uretir (expo-notifications), bu yuzden token UNIQUE ve "upsert"
-- deseniyle yaziliyor: ayni token tekrar kaydedilirse device_id/user_id
-- GUNCELLENIR (alarms/preferences'taki "claim on login" desenden farkli --
-- orada misafir satiri hesaba TASINIYOR; burada ise ayni token'i o an
-- kullanan kim ise ona ait olarak isaretliyoruz, cunku ayni telefonda
-- farkli hesaplarla giris cikis yapilabilir).
CREATE TABLE IF NOT EXISTS push_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  device_id TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_device ON push_tokens(device_id);

CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history(product_id, checked_at);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_products_store ON products(store);
CREATE INDEX IF NOT EXISTS idx_products_group ON products(group_slug);
CREATE INDEX IF NOT EXISTS idx_alarms_device ON alarms(device_id);
`;

db.exec(SCHEMA);

// --- Migration: alarms.user_id -----------------------------------------
// SCHEMA yukarida "CREATE TABLE IF NOT EXISTS" oldugu icin zaten var olan
// (eski) bir veritabaninda alarms tablosuna otomatik yeni sutun eklenmez --
// bu yuzden db.py'deki ayni yaklasimla burada da ayrica bir ALTER TABLE
// migration'i yapiyoruz. Giris yapmis bir kullanicinin alarmlari
// user_id'ye baglanir; misafir/cihaz-bazli alarmlar (user_id NULL) eskisi
// gibi device_id ile calismaya devam eder.
const alarmsColumns = db.prepare('PRAGMA table_info(alarms)').all().map((c) => c.name);
if (!alarmsColumns.includes('user_id')) {
  db.exec('ALTER TABLE alarms ADD COLUMN user_id INTEGER REFERENCES users(id)');
}
if (!alarmsColumns.includes('notified_at')) {
  // Push bildirimi gonderildiginde doldurulur (bkz.
  // import_telegram_signals.js) -- fiyat hedefin altindayken HER import
  // calistiginda (varsayilan 5 dk) tekrar tekrar bildirim atmamak icin.
  // Fiyat tekrar hedefin ustune cikarsa NULL'a donuyoruz, boylece bir
  // sonraki "hedefin altina dusme" ani yeniden bildirim uretir.
  db.exec('ALTER TABLE alarms ADD COLUMN notified_at TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_alarms_user ON alarms(user_id)');

// --- Migration: users.apple_id -----------------------------------------
// "Apple ile giriş yap" icin (bkz. routes/auth.js, POST /auth/apple).
// Apple'in verdigi kararli kullanici kimligi (JWT'deki "sub" claim'i)
// burada saklanir. NULL olabilir (e-posta/sifre ile acilmis hesaplarda
// bos kalir); UNIQUE index NULL degerlerde tekillik aramaz, yani birden
// fazla e-posta/sifre hesabi ayni anda apple_id=NULL olabilir, sorun degil.
const usersColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
if (!usersColumns.includes('apple_id')) {
  db.exec('ALTER TABLE users ADD COLUMN apple_id TEXT');
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_apple_id ON users(apple_id)');

function nowIso() {
  return new Date().toISOString();
}

function hoursFromNow(h) {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

function daysAgo(d) {
  return new Date(Date.now() - d * 24 * 3600 * 1000).toISOString();
}

// Mevcut ekranlarda kullanilan gercek gorseller (Supabase, FireVibe.ai
// tarafindan uretildi). Yeni eklenen "doldurma" urunler icin de gecici
// olarak bu gorsellerden birini kullaniyoruz -- gercek gorseller affiliate
// feed/Telegram entegrasyonu ile gelecek.
const IMG = {
  sony: 'https://fwtngjyirchhhysukjxi.supabase.co/storage/v1/object/public/project-images/4fdf0ace-7576-4993-b358-790efab88383/14bf60d8-94b1-450d-86c7-ce3fc451bb63.png',
  philips: 'https://fwtngjyirchhhysukjxi.supabase.co/storage/v1/object/public/project-images/4fdf0ace-7576-4993-b358-790efab88383/45651df9-9dad-4911-bef5-1a811519802e.png',
  airpods: 'https://fwtngjyirchhhysukjxi.supabase.co/storage/v1/object/public/project-images/4fdf0ace-7576-4993-b358-790efab88383/a6231613-1bb3-437e-8dbb-bdfd01c5e299.png',
};

function seedIfEmpty() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM products').get();
  if (count > 0) return;

  const insertProduct = db.prepare(`
    INSERT INTO products
      (group_slug, title, brand, category, store, store_url, image_url,
       current_price, old_price, currency, stock_status, is_flash_deal,
       flash_deal_ends_at, coupon_code, follow_count, verified_at, source,
       created_at, updated_at)
    VALUES
      (@group_slug, @title, @brand, @category, @store, @store_url, @image_url,
       @current_price, @old_price, @currency, @stock_status, @is_flash_deal,
       @flash_deal_ends_at, @coupon_code, @follow_count, @verified_at, @source,
       @created_at, @updated_at)
  `);
  const insertHistory = db.prepare(`
    INSERT INTO price_history (product_id, price, checked_at) VALUES (?, ?, ?)
  `);

  const insertAll = db.transaction((rows) => {
    for (const row of rows) {
      const info = insertProduct.run({
        group_slug: row.group_slug || null,
        title: row.title,
        brand: row.brand || null,
        category: row.category,
        store: row.store,
        store_url: row.store_url,
        image_url: row.image_url || null,
        current_price: row.current_price,
        old_price: row.old_price ?? null,
        currency: 'TRY',
        stock_status: row.stock_status || 'in_stock',
        is_flash_deal: row.is_flash_deal ? 1 : 0,
        flash_deal_ends_at: row.flash_deal_ends_at || null,
        coupon_code: row.coupon_code || null,
        follow_count: row.follow_count || 0,
        verified_at: row.verified_at || nowIso(),
        source: row.source || 'manual',
        created_at: nowIso(),
        updated_at: nowIso(),
      });
      const productId = info.lastInsertRowid;

      // 30 gunluk basit bir fiyat gecmisi uret: eski fiyattan guncel
      // fiyata dogru kabaca inen, hafif rastgele dalgali bir seri.
      const points = row.priceHistory || 12;
      const start = row.old_price || row.current_price * 1.2;
      const end = row.current_price;
      for (let i = 0; i < points; i++) {
        const t = i / (points - 1);
        const base = start + (end - start) * t;
        const noise = (Math.sin(i * 1.7) * 0.015 + (Math.random() - 0.5) * 0.01) * base;
        const price = Math.max(end * 0.97, Math.round(base + noise));
        const daysBack = Math.round((points - 1 - i) * (29 / (points - 1)));
        insertHistory.run(productId, price, daysAgo(daysBack));
      }
      // Guncel fiyati serinin son noktasi olarak da ekle (bugun).
      insertHistory.run(productId, end, nowIso());
    }
  });

  insertAll([
    {
      group_slug: 'sony-wh-1000xm5',
      title: 'Sony WH-1000XM5 Kulaklık',
      brand: 'Sony',
      category: 'elektronik',
      store: 'amazon',
      store_url: 'https://www.amazon.com.tr/dp/example-sony-wh1000xm5',
      image_url: IMG.sony,
      current_price: 7149,
      old_price: 12999,
      is_flash_deal: true,
      flash_deal_ends_at: hoursFromNow(2.25),
      coupon_code: 'INDIRIM50',
      follow_count: 2418,
      source: 'manual',
      priceHistory: 14,
    },
    {
      group_slug: 'sony-wh-1000xm5',
      title: 'Sony WH-1000XM5 Kulaklık',
      brand: 'Sony',
      category: 'elektronik',
      store: 'trendyol',
      store_url: 'https://www.trendyol.com/example-sony-wh1000xm5',
      image_url: IMG.sony,
      current_price: 7499,
      old_price: 12999,
      follow_count: 340,
      source: 'manual',
      priceHistory: 6,
    },
    {
      group_slug: 'sony-wh-1000xm5',
      title: 'Sony WH-1000XM5 Kulaklık',
      brand: 'Sony',
      category: 'elektronik',
      store: 'hepsiburada',
      store_url: 'https://www.hepsiburada.com/example-sony-wh1000xm5',
      image_url: IMG.sony,
      current_price: 7699,
      old_price: 12999,
      follow_count: 210,
      source: 'manual',
      priceHistory: 6,
    },
    {
      group_slug: 'philips-lattego-ep2231',
      title: 'Philips LatteGo EP2231/40',
      brand: 'Philips',
      category: 'ev-yasam',
      store: 'trendyol',
      store_url: 'https://www.trendyol.com/example-philips-lattego',
      image_url: IMG.philips,
      current_price: 15799,
      old_price: 21499,
      follow_count: 1964,
      source: 'manual',
      priceHistory: 10,
    },
    {
      group_slug: 'airpods-pro-2',
      title: 'Apple AirPods Pro 2',
      brand: 'Apple',
      category: 'elektronik',
      store: 'hepsiburada',
      store_url: 'https://www.hepsiburada.com/example-airpods-pro-2',
      image_url: IMG.airpods,
      current_price: 7899,
      old_price: 9499,
      follow_count: 1527,
      source: 'manual',
      priceHistory: 8,
    },
    {
      title: 'Starbucks Grande Latte',
      brand: 'Starbucks',
      category: 'yemek',
      store: 'trendyol-yemek',
      store_url: 'https://yemek.trendyol.com/example-starbucks-latte',
      image_url: null,
      current_price: 119,
      old_price: 165,
      follow_count: 612,
      source: 'manual',
      priceHistory: 5,
    },
    // Kategori sayaclarinin sifir gorunmemesi icin birkac dolgu urun.
    // Bunlar gercek affiliate/Telegram entegrasyonu gelene kadar
    // yer tutuculardir (bkz. backend README).
    { title: 'Nike Air Max 90', brand: 'Nike', category: 'moda', store: 'trendyol', store_url: 'https://www.trendyol.com/example-nike-air-max-90', image_url: IMG.sony, current_price: 2999, old_price: 4299, follow_count: 88, source: 'manual', priceHistory: 4 },
    { title: 'Mavi Kot Ceket', brand: 'Mavi', category: 'moda', store: 'hepsiburada', store_url: 'https://www.hepsiburada.com/example-mavi-kot-ceket', image_url: IMG.sony, current_price: 799, old_price: 1299, follow_count: 41, source: 'manual', priceHistory: 4 },
    { title: 'Getir Büyük Kahvaltı Tepsisi', brand: 'Getir', category: 'yemek', store: 'trendyol-yemek', store_url: 'https://yemek.trendyol.com/example-kahvalti-tepsisi', image_url: null, current_price: 249, old_price: 350, follow_count: 56, source: 'manual', priceHistory: 3 },
    { title: 'The Ordinary Niacinamide Set', brand: 'The Ordinary', category: 'kozmetik', store: 'trendyol', store_url: 'https://www.trendyol.com/example-ordinary-set', image_url: IMG.philips, current_price: 649, old_price: 899, follow_count: 73, source: 'manual', priceHistory: 4 },
    { title: "L'Oréal Paris Şampuan Seti", brand: "L'Oréal", category: 'kozmetik', store: 'hepsiburada', store_url: 'https://www.hepsiburada.com/example-loreal-sampuan-seti', image_url: IMG.philips, current_price: 299, old_price: 450, follow_count: 39, source: 'manual', priceHistory: 3 },
    { title: 'Decathlon Yoga Matı', brand: 'Decathlon', category: 'spor', store: 'trendyol', store_url: 'https://www.trendyol.com/example-yoga-mati', image_url: IMG.airpods, current_price: 249, old_price: 399, follow_count: 27, source: 'manual', priceHistory: 3 },
    { title: 'Adidas Koşu Ayakkabısı', brand: 'Adidas', category: 'spor', store: 'amazon', store_url: 'https://www.amazon.com.tr/dp/example-adidas-kosu', image_url: IMG.airpods, current_price: 1999, old_price: 2999, follow_count: 64, source: 'manual', priceHistory: 4 },
    { title: 'IKEA Masa Lambası', brand: 'IKEA', category: 'ev-yasam', store: 'hepsiburada', store_url: 'https://www.hepsiburada.com/example-ikea-masa-lambasi', image_url: IMG.philips, current_price: 399, old_price: 599, follow_count: 19, source: 'manual', priceHistory: 3 },
  ]);

  // Ornek fiyat alarmlari (Alarmlar ekrani icin) -- tek bir "demo-device"
  // uzerinden, cunku henuz bir kullanici/auth sistemi yok.
  const sony = db.prepare("SELECT id FROM products WHERE store = 'amazon' AND group_slug = 'sony-wh-1000xm5'").get();
  const philips = db.prepare("SELECT id FROM products WHERE group_slug = 'philips-lattego-ep2231'").get();
  const airpods = db.prepare("SELECT id FROM products WHERE group_slug = 'airpods-pro-2'").get();

  const insertAlarm = db.prepare(`
    INSERT INTO alarms (product_id, device_id, target_price, active, created_at)
    VALUES (?, 'demo-device', ?, ?, ?)
  `);
  if (sony) insertAlarm.run(sony.id, 7000, 1, nowIso());
  if (philips) insertAlarm.run(philips.id, 15500, 1, nowIso());
  if (airpods) insertAlarm.run(airpods.id, 7500, 0, nowIso());

  console.log('[db] Seed data eklendi.');
}

seedIfEmpty();

// Telegram entegrasyonu devreye girdikten sonra, "kategoriler bos
// gorunmesin" diye eklenen ornek/dolgu urunler (source='manual' --
// Sony, Philips, AirPods vb., URL'lerinde "example-" gecen sahte
// linkler) artik gereksiz ve kafa karistiriyor: gercek Telegram
// verisiyle ayni listede/alarmlarda goruniyorlardi. Gercek veri
// geldiyse (source='telegram' en az bir satir varsa) bu dolgu
// kayitlari bir kere temizleriz; alarms/price_history de ON DELETE
// CASCADE ile birlikte silinir. Henuz hic gercek veri yoksa
// dokunmuyoruz (o zaman placeholder'lar hala isine yariyor).
function cleanupDemoDataIfRealDataExists() {
  const { count: telegramCount } = db
    .prepare("SELECT COUNT(*) AS count FROM products WHERE source = 'telegram'")
    .get();
  if (telegramCount === 0) return;

  const info = db.prepare("DELETE FROM products WHERE source = 'manual'").run();
  if (info.changes > 0) {
    console.log(`[db] ${info.changes} ornek/demo urun temizlendi (artik gercek Telegram verisi var).`);
  }
}

cleanupDemoDataIfRealDataExists();

if (require.main === module && process.argv.includes('--seed')) {
  console.log('[db] DB hazir:', DB_PATH);
}

module.exports = { db, nowIso, DB_PATH };
