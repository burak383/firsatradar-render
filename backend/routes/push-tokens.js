// routes/push-tokens.js
// -----------------------------------------------------------------------
// Uygulamanin push bildirim jetonunu (Expo push token) kaydettigi tek
// endpoint. Bildirimler bu tabloyu okuyarak gonderilir (bkz.
// pushNotifications.js, import_telegram_signals.js). Alarmlar/tercihler
// ile ayni "misafir/hesap" ayrimini kullanir (authOptional) ama "claim on
// login" DEGIL -- ayni telefonda farkli hesaplarla giris/cikis
// yapilabilecegi icin, token her kaydedildiginde o anki device_id/user_id
// ile GUNCELLENIR (bkz. db.js'teki push_tokens tablosu yorumu).
const express = require('express');
const { db, nowIso } = require('../db');
const { authOptional } = require('../authMiddleware');

const router = express.Router();
router.use(authOptional);

function isLikelyExpoPushToken(value) {
  return typeof value === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(value.trim());
}

// POST /api/push-tokens { token, deviceId }
// Uygulama acilista (izin verildiyse) bunu cagirir -- bkz. notifications.ts.
router.post('/', (req, res) => {
  const token = (req.body?.token || '').toString().trim();
  const deviceId = (req.body?.deviceId || 'demo-device').toString();

  if (!isLikelyExpoPushToken(token)) {
    return res.status(400).json({ error: 'Geçersiz push jetonu.' });
  }

  const now = nowIso();
  db.prepare(
    `INSERT INTO push_tokens (token, device_id, user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(token) DO UPDATE SET
       device_id = excluded.device_id,
       user_id = excluded.user_id,
       updated_at = excluded.updated_at`
  ).run(token, deviceId, req.user ? req.user.id : null, now, now);

  res.status(204).end();
});

// DELETE /api/push-tokens { token } -- cikis yapinca ya da bildirimleri
// kapatinca istemci bunu cagirabilir; token bulunamazsa sessizce 204 doner.
router.delete('/', (req, res) => {
  const token = (req.body?.token || '').toString().trim();
  if (token) {
    db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
  }
  res.status(204).end();
});

module.exports = router;
