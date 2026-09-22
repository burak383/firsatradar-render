const express = require('express');
const { db, nowIso } = require('../db');
const { toDealSummary } = require('../helpers');

const router = express.Router();

// Not: Henuz bir kullanici/auth sistemi yok. Istekler bir `device` sorgu
// parametresi ile tanimlaniyor (yoksa 'demo-device'). Ilerde gercek
// kullanici girisi eklenince bunu auth'tan gelen kullanici id'siyle
// degistirmek yeterli -- API sekli ayni kalir.
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

// GET /api/alarms?device=demo-device
router.get('/', (req, res) => {
  const deviceId = deviceIdFrom(req);
  const rows = db
    .prepare('SELECT * FROM alarms WHERE device_id = ? ORDER BY created_at DESC')
    .all(deviceId);

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
  const { productId, targetPrice, deviceId } = req.body || {};
  const pid = parseInt(productId, 10);
  if (Number.isNaN(pid)) return res.status(400).json({ error: 'productId gerekli' });

  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(pid);
  if (!product) return res.status(404).json({ error: 'Urun bulunamadi' });

  const info = db
    .prepare(
      `INSERT INTO alarms (product_id, device_id, target_price, active, created_at)
       VALUES (?, ?, ?, 1, ?)`
    )
    .run(pid, (deviceId || 'demo-device').toString(), targetPrice ?? null, nowIso());

  const row = db.prepare('SELECT * FROM alarms WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json({ alarm: rowToAlarm(row) });
});

// PATCH /api/alarms/:id  { active?, targetPrice? }
router.patch('/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM alarms WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Alarm bulunamadi' });

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
  const info = db.prepare('DELETE FROM alarms WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'Alarm bulunamadi' });
  res.status(204).end();
});

module.exports = router;
