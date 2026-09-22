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

// GET /api/deals?category=&store=&sort=&limit=&q=
router.get('/', (req, res) => {
  const { category, store, sort = 'discount', limit = '30', q } = req.query;

  const where = [];
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

  const rows = db
    .prepare(`SELECT * FROM products ${whereSql} ORDER BY ${orderBy} LIMIT ${lim}`)
    .all(params);

  const { count: totalScanned } = db.prepare('SELECT COUNT(*) AS count FROM products').get();

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
       WHERE is_flash_deal = 1 AND (flash_deal_ends_at IS NULL OR flash_deal_ends_at > datetime('now'))
       ORDER BY flash_deal_ends_at ASC LIMIT 1`
    )
    .get();
  if (!row) return res.json({ deal: null });
  res.json({ deal: toDealDetail(db, row) });
});

// GET /api/deals/featured -> en yuksek indirimli tek urun (KeFet'teki "one buyuk kart")
router.get('/featured', (req, res) => {
  const row = db
    .prepare(
      `SELECT * FROM products
       WHERE old_price IS NOT NULL AND old_price > current_price
       ORDER BY (old_price - current_price) * 1.0 / old_price DESC
       LIMIT 1`
    )
    .get();
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
