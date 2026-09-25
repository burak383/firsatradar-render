// routes/preferences.js
// -----------------------------------------------------------------------
// Profil ekranindaki "Tercihler": takip edilen pazaryerleri, ilgi alani
// kategorileri, anlik fırsat bildirimi acik/kapali. Alarmlar ile ayni
// desen (bkz. routes/alarms.js): giris yapmamis kullanicida device_id
// ile, giris yapmista user_id ile calisir -- boylece misafirken ayarlanan
// tercihler kaybolmaz, hesap acilinca/giris yapilinca o hesaba devredilir.
const express = require('express');
const { db, nowIso } = require('../db');
const { authOptional } = require('../authMiddleware');

const router = express.Router();
router.use(authOptional);

// Profil ekranindaki pazaryeri rozetleriyle ayni sabit liste (bkz. Profil.tsx).
const KNOWN_STORES = ['amazon', 'trendyol', 'hepsiburada', 'trendyol-yemek', 'n11'];

function deviceIdFrom(req) {
  return (req.query.device || req.body?.deviceId || 'demo-device').toString();
}

function sanitizeStores(value) {
  if (!Array.isArray(value)) return null;
  const set = new Set(value.map((v) => String(v)));
  return KNOWN_STORES.filter((s) => set.has(s));
}

function sanitizeCategories(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const v of value) {
    const slug = String(v).trim();
    if (slug && !seen.has(slug)) {
      seen.add(slug);
      out.push(slug);
    }
  }
  return out;
}

function rowToPreferences(row) {
  if (!row) return { stores: [], categories: [], notificationsEnabled: true };
  let stores = [];
  let categories = [];
  try {
    stores = JSON.parse(row.stores || '[]');
  } catch {
    stores = [];
  }
  try {
    categories = JSON.parse(row.categories || '[]');
  } catch {
    categories = [];
  }
  return { stores, categories, notificationsEnabled: !!row.notifications_enabled };
}

function findRow(req) {
  if (req.user) {
    return db.prepare('SELECT * FROM user_preferences WHERE user_id = ?').get(req.user.id);
  }
  return db
    .prepare('SELECT * FROM user_preferences WHERE device_id = ? AND user_id IS NULL')
    .get(deviceIdFrom(req));
}

// GET /api/preferences?device=demo-device (giris yapilmissa token'daki
// hesap, device parametresinin onune gecer)
router.get('/', (req, res) => {
  if (req.user) {
    // Bu hesabin henuz kendi tercih satiri yoksa, bu CIHAZDA misafirken
    // ayarlanmis (henuz hesaba baglanmamis) bir satir varsa ona devret.
    const already = db.prepare('SELECT id FROM user_preferences WHERE user_id = ?').get(req.user.id);
    if (!already) {
      const guestRow = db
        .prepare('SELECT * FROM user_preferences WHERE device_id = ? AND user_id IS NULL')
        .get(deviceIdFrom(req));
      if (guestRow) {
        db.prepare('UPDATE user_preferences SET user_id = ? WHERE id = ?').run(req.user.id, guestRow.id);
      }
    }
  }

  res.json({ preferences: rowToPreferences(findRow(req)) });
});

// PUT /api/preferences { stores?, categories?, notificationsEnabled?, deviceId }
// Sadece govdede gonderilen alanlar guncellenir -- gonderilmeyenler oldugu gibi kalir.
router.put('/', (req, res) => {
  const stores = req.body?.stores !== undefined ? sanitizeStores(req.body.stores) : null;
  const categories = req.body?.categories !== undefined ? sanitizeCategories(req.body.categories) : null;
  const notificationsEnabled = req.body?.notificationsEnabled;
  const notifValue = notificationsEnabled === undefined ? null : notificationsEnabled ? 1 : 0;

  const existing = findRow(req);

  if (existing) {
    db.prepare(
      `UPDATE user_preferences SET
         stores = COALESCE(?, stores),
         categories = COALESCE(?, categories),
         notifications_enabled = COALESCE(?, notifications_enabled),
         updated_at = ?
       WHERE id = ?`
    ).run(
      stores !== null ? JSON.stringify(stores) : null,
      categories !== null ? JSON.stringify(categories) : null,
      notifValue,
      nowIso(),
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO user_preferences
         (device_id, user_id, stores, categories, notifications_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.user ? null : deviceIdFrom(req),
      req.user ? req.user.id : null,
      JSON.stringify(stores || []),
      JSON.stringify(categories || []),
      notifValue === null ? 1 : notifValue,
      nowIso(),
      nowIso()
    );
  }

  res.json({ preferences: rowToPreferences(findRow(req)) });
});

module.exports = router;
