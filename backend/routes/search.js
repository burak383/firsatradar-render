const express = require('express');
const { db } = require('../db');
const { toDealDetail, toDealSummary } = require('../helpers');

const router = express.Router();

// GET /api/search?q=sony
// En ucuz eslesmeyi "birincil" firsat olarak dondurur, ayni group_slug'a
// sahip diger magaza satirlarini da "comparisons" olarak ekler (Arama
// ekranindaki magaza karsilastirma bolumu icin).
router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) {
    return res.json({ query: q, resultCount: 0, primary: null, comparisons: [] });
  }

  const matches = db
    .prepare('SELECT * FROM products WHERE title LIKE ? ORDER BY current_price ASC')
    .all(`%${q}%`);

  if (matches.length === 0) {
    return res.json({ query: q, resultCount: 0, primary: null, comparisons: [] });
  }

  const primaryRow = matches[0];
  const primary = toDealDetail(db, primaryRow);

  let comparisonRows = [];
  if (primaryRow.group_slug) {
    comparisonRows = db
      .prepare(
        `SELECT * FROM products WHERE group_slug = ? AND id != ? ORDER BY current_price ASC`
      )
      .all(primaryRow.group_slug, primaryRow.id);
  } else {
    comparisonRows = matches.filter((m) => m.id !== primaryRow.id);
  }

  res.json({
    query: q,
    resultCount: matches.length,
    primary,
    comparisons: comparisonRows.map((r) => toDealSummary(db, r)),
  });
});

module.exports = router;
