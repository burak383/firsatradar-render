const express = require('express');
const { db } = require('../db');
const { toDealSummary, toDealDetail } = require('../helpers');

const router = express.Router();

const SORTS = {
  discount: `
    (CASE WHEN old_price IS NOT NULL AND old_price > current_price
          THEN (old_price - current_price) * 1.0 / old_price ELSE 0 END) DESC
  `,
  'price-asc': 'current_price ASC',
  'price-desc': 'current_price DESC',
  newest: 'created_at DESC',
  followers: 'follow_count DESC',
};

const FRESH_MAX_AGE_HOURS = Number(process.env.FEATURED_MAX_AGE_HOURS || 24);
const FRESH_POOL_SIZE = Number(process.env.FRESH_POOL_SIZE || 24);
const FRESH_STEP = Number(process.env.FRESH_STEP || 2);

// Yeni (son N saat), makul indirimli (%10-%80) urunlerden olusan bir havuz
// kurar ve her saat havuzda FRESH_STEP kadar ilerleyerek `lim` urun dondurur.
// Boylece iki kucuk kart saatte bir yeni urunlerle degisir. Havuz bossa 3 gune,
// o da bossa yas sinirsiz genisler.
function pickFreshRotation(baseWhere, params, lim) {
  const discountExpr = '(old_price - current_price) * 1.0 / old_price';
  const build = (maxAgeHours) => {
    const w = [
      ...baseWhere,
      'old_price IS NOT NULL',
      'old_price > current_price',
      `${discountExpr} <= 0.8`,
      `${discountExpr} >= 0.1`,
    ];
    if (maxAgeHours != null) {
      w.push(
        `julianday(MAX(created_at, updated_at)) > julianday('now', '-${Number(maxAgeHours)} hours')`
      );
    }
    return db
      .prepare(
        `SELECT * FROM products WHERE ${w.join(' AND ')}
         ORDER BY ${discountExpr} DESC LIMIT ${FRESH_POOL_SIZE}`
      )
      .all(params);
  };
  let pool = build(FRESH_MAX_AGE_HOURS);
  if (!pool.length) pool = build(72);
  if (!pool.length) pool = build(null);
  if (!pool.length) return [];
  const hourBucket = Math.floor(Date.now() / 3600000);
  const start = (hourBucket * FRESH_STEP) % pool.length;
  const count = Math.min(lim, pool.length);
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(pool[(start + i) % pool.length]);
  return out;
}

// GET /api/deals?category=&store=&sort=&limit=&q=&fresh=1
router.get('/', (req, res) => {
  const { category, store, sort = 'discount', limit = '30', q, fresh } = req.query;

  // hidden = 1: fiyati guvenilmez bulunup gizlenen urunler (bkz. db.js
  // products.hidden / import_telegram_signals.js cleanup_v2).
  const where = ['hidden = 0'];
  const params = {};
  if (category && category !== 'all') {
    where.push('category = @category');
    params.category = category;
  }
  if (store && store !== 'all') {
    where.push('store = @store');
    params.store = store;
  }
  if (q) {
    where.push('title LIKE @q');
    params.q = `%${q}%`;
  }

  const orderBy = SORTS[sort] || SORTS.discount;
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const lim = Math.min(parseInt(limit, 10) || 30, 100);

  let rows;
  if (fresh === '1' && (sort === 'discount' || !SORTS[sort])) {
    // KeFet'te buyuk "One cikan" kartin altindaki iki urun: sadece yeni
    // urunlerden, saatte bir donen secki (bkz. pickFreshRotation).
    rows = pickFreshRotation(where, params, lim);
  } else {
    rows = db
      .prepare(`SELECT * FROM products ${whereSql} ORDER BY ${orderBy} LIMIT ${lim}`)
      .all(params);
  }

  const { count: totalScanned } = db
    .prepare('SELECT COUNT(*) AS count FROM products WHERE hidden = 0')
    .get();

  res.json({
    deals: rows.map((r) => toDealSummary(db, r)),
    totalScanned,
  });
});

// GET /api/deals/flash -> aktif "sureli firsat" (varsa)
router.get('/flash', (req, res) => {
  const row = db
    .prepare(
      `SELECT * FROM products
       WHERE hidden = 0 AND is_flash_deal = 1
         AND (flash_deal_ends_at IS NULL OR flash_deal_ends_at > datetime('now'))
       ORDER BY flash_deal_ends_at ASC LIMIT 1`
    )
    .get();
  if (!row) return res.json({ deal: null });
  res.json({ deal: toDealDetail(db, row) });
});

// GET /api/deals/featured -> KeFet'teki "Öne çıkan fırsatlar" buyuk karti.
// Eskiden "tum zamanlarin en yuksek indirimli urunu"nu donduruyordu; yeni
// urun gelse bile ayni kart gunlerce degismiyordu. Simdi:
//  - sadece son FEATURED_MAX_AGE_HOURS saat icinde guncellenen/eklenen
//    urunlerden secilir (yoksa pencere 3 gun, sonra tum zamanlar olarak genisler),
//  - %80'in ustundeki indirimler supheli sayilip vitrine alinmaz (parser
//    hatasi kaynakli sahte indirimler),
//  - en iyi FEATURED_POOL_SIZE aday arasindan SAATE gore doner: her saat
//    basi bir sonraki aday vitrine cikar.
const FEATURED_MAX_AGE_HOURS = Number(process.env.FEATURED_MAX_AGE_HOURS || 24);
const FEATURED_POOL_SIZE = Number(process.env.FEATURED_POOL_SIZE || 8);
const FEATURED_MAX_DISCOUNT = 0.8;

function pickFeatured(maxAgeHours) {
  const ageSql =
    maxAgeHours == null
      ? ''
      : `AND julianday(MAX(created_at, updated_at)) > julianday('now', '-${Number(maxAgeHours)} hours')`;
  const rows = db
    .prepare(
      `SELECT * FROM products
       WHERE hidden = 0 AND old_price IS NOT NULL AND old_price > current_price
         AND (old_price - current_price) * 1.0 / old_price <= ${FEATURED_MAX_DISCOUNT}
         AND (old_price - current_price) * 1.0 / old_price >= 0.1
         ${ageSql}
       ORDER BY (old_price - current_price) * 1.0 / old_price DESC
       LIMIT ${FEATURED_POOL_SIZE}`
    )
    .all();
  if (!rows.length) return null;
  const hourBucket = Math.floor(Date.now() / 3600000);
  return rows[hourBucket % rows.length];
}

router.get('/featured', (req, res) => {
  const row =
    pickFeatured(FEATURED_MAX_AGE_HOURS) || pickFeatured(72) || pickFeatured(null);
  if (!row) return res.json({ deal: null });
  res.json({ deal: toDealDetail(db, row) });
});

// GET /api/deals/:id -> tek urun detayi (fiyat gecmisi dahil)
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ error: 'Gecersiz id' });

  const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Urun bulunamadi' });

  res.json({ deal: toDealDetail(db, row) });
});

module.exports = router;
