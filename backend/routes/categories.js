const express = require('express');
const { db } = require('../db');

const router = express.Router();

// Turkce baslik + ikon onerisi (frontend kendi ikon setiyle eslestirebilir).
const CATEGORY_META = {
  elektronik: { title: 'Elektronik', icon: 'headphones' },
  moda: { title: 'Moda', icon: 'shopping-bag' },
  yemek: { title: 'Market & Yemek', icon: 'shopping-cart' },
  kozmetik: { title: 'Kozmetik', icon: 'droplet' },
  spor: { title: 'Spor', icon: 'activity' },
  'ev-yasam': { title: 'Ev & Yaşam', icon: 'home' },
  diger: { title: 'Diğer', icon: 'grid' },
};

// GET /api/categories -> her kategori icin urun sayisi
router.get('/', (req, res) => {
  const rows = db
    .prepare(
      `SELECT category, COUNT(*) AS count
       FROM products
       GROUP BY category
       ORDER BY count DESC`
    )
    .all();

  const categories = rows.map((r) => ({
    slug: r.category,
    title: CATEGORY_META[r.category]?.title || r.category,
    icon: CATEGORY_META[r.category]?.icon || 'grid',
    count: r.count,
  }));

  res.json({ categories });
});

module.exports = router;
