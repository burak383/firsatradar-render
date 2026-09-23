const express = require('express');
const { db, nowIso } = require('../db');
const { toDealSummary } = require('../helpers');
const { authOptional } = require('../authMiddleware');

const router = express.Router();

// Giris yapmis bir kullaniciysa (Authorization: Bearer <token>, bkz.
// authMiddleware.js) alarmlar HESABA baglanir; degilse eskisi gibi bir
// `device` sorgu parametresiyle (yoksa 'demo-device') cihaz bazli calisir.
// Boylece hesap sistemi eklenmeden once olusmus misafir alarmlari da
// calismaya devam eder.
router.use(authOptional);

function deviceIdFrom(req) {
  return (req.query.device || req.body?.deviceId || 'demo-device').toString();
}

function rowToAlarm(row) {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(row.product_id);
  const deal = product ? toDealSummary(db, product) : null;
  const dropAmount = product && product.old_price ? product.old_price - product.current_price : 0;

  return {
    id: row.id,
    productId: row.product_id,
    targetPrice: row.target_price,
    active: !!row.active,
    createdAt: row.created_at,
    deal,
    dropText: dropAmount > 0 ? `Son 30 günde ₺${Math.round(dropAmount).toLocaleString('tr-TR')} düştü` : null,
  };
}

// GET /api/alarms?device=demo-device (giris yapilmissa token'daki hesap,
// device parametresinin onune gecer)
router.get('/', (req, res) => {
  const rows = req.user
    ? db.prepare('SELECT * FROM alarms WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id)
    : db
        .prepare('SELECT * FROM alarms WHERE device_id = ? AND user_id IS NULL ORDER BY created_at DESC')
        .all(deviceIdFrom(req));

  const alarms = rows.map(rowToAlarm);
  const trackedCount = alarms.length;
  const potentialSavings = alarms.reduce((sum, a) => {
    if (!a.active || !a.deal || !a.deal.oldPrice) return sum;
    return sum + Math.max(0, a.deal.oldPrice - a.deal.currentPrice);
  }, 0);

  res.json({
    alarms,
    summary: { trackedCount, potentialSavings: Math.round(potentialSavings) },
  });
});

// POST /api/alarms { productId, targetPrice, deviceId }
router.post('/', (req, res) => {
  const { productId, targetPrice } = req.body || {};
  const pid = parseInt(productId, 10);
  if (Number.isNaN(pid)) return res.status(400).json({ error: 'productId gerekli' });

  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(pid);
  if (!product) return res.status(404).json({ error: 'Urun bulunamadi' });

  const deviceId = deviceIdFrom(req);
  const info = db
    .prepare(
      `INSERT INTO alarms (product_id, device_id, user_id, target_price, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(pid, deviceId, req.user ? req.user.id : null, targetPrice ?? null, nowIso());

  const row = db.prepare('SELECT * FROM alarms WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ alarm: rowToAlarm(row) });
});

// PATCH /api/alarms/:id  { active?, targetPrice? }
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM alarms WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Alarm bulunamadi' });

  // Bir hesaba baglanmis alarmi sadece o hesabin sahibi degistirebilir.
  // Misafir (user_id NULL) alarmlarda henuz cihaz bazli bir sahiplik
  // kontrolu yok -- eskisi gibi davranmaya devam ediyor.
  if (existing.user_id != null && (!req.user || req.user.id !== existing.user_id)) {
    return res.status(403).json({ error: 'Bu alarm başka bir hesaba ait.' });
  }

  const active = req.body?.active;
  const targetPrice = req.body?.targetPrice;

  db.prepare(
    `UPDATE alarms SET
       active = COALESCE(?, active),
       target_price = COALESCE(?, target_price)
     WHERE id = ?`
  ).run(active === undefined ? null : (active ? 1 : 0), targetPrice ?? null, id);

  const row = db.prepare('SELECT * FROM alarms WHERE id = ?').get(id);
  res.json({ alarm: rowToAlarm(row) });
});

// DELETE /api/alarms/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM alarms WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Alarm bulunamadi' });

  if (existing.user_id != null && (!req.user || req.user.id !== existing.user_id)) {
    return res.status(403).json({ error: 'Bu alarm başka bir hesaba ait.' });
  }

  db.prepare('DELETE FROM alarms WHERE id = ?').run(id);
  res.status(204).end();
});

module.exports = router;
