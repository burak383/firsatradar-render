// routes/auth.js
// -----------------------------------------------------------------------
// E-posta + sifre ile kayit/giris. Sifreler asla duz metin tutulmaz
// (bcryptjs ile hash'lenir), giris basariliysa bir JWT dondurulur --
// istemci bunu Authorization: Bearer <token> basligiyla sonraki
// isteklerde gonderir (bkz. authMiddleware.js).
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, nowIso } = require('../db');
const { getJwtSecret } = require('../authSecret');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL = '30d';
const PASSWORD_HASH_ROUNDS = 10;

function normalizeEmail(raw) {
  return (raw || '').toString().trim().toLowerCase();
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, getJwtSecret(), { expiresIn: TOKEN_TTL });
}

function toPublicUser(row) {
  return { id: row.id, email: row.email };
}

// Kullanici kayit olurken/giris yaparken, o ana kadar bu CIHAZDA misafir
// olarak (device_id ile, henuz hicbir hesaba baglanmamis) eklenmis
// alarmlar varsa hesaba devrederiz -- boylece kullanici kayit olunca o
// zamana kadar eklemis oldugu alarmlari kaybetmez. Ayni device_id'yi
// tutmaya devam ediyoruz (sadece bilgi amacli), asil sahiplik artik
// user_id ile belirleniyor.
function claimDeviceAlarms(userId, deviceId) {
  if (!deviceId) return;
  db.prepare(
    `UPDATE alarms SET user_id = ? WHERE device_id = ? AND user_id IS NULL`
  ).run(userId, String(deviceId));
}

// POST /api/auth/register { email, password, deviceId? }
router.post('/register', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = (req.body?.password || '').toString();
  const deviceId = req.body?.deviceId;

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Geçerli bir e-posta adresi gir.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Şifre en az 6 karakter olmalı.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'Bu e-posta zaten kayıtlı. Giriş yapmayı dene.' });
  }

  const passwordHash = await bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
  const info = db
    .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
    .run(email, passwordHash, nowIso());

  const user = { id: info.lastInsertRowid, email };
  claimDeviceAlarms(user.id, deviceId);

  res.status(201).json({ token: issueToken(user), user: toPublicUser(user) });
});

// POST /api/auth/login { email, password, deviceId? }
router.post('/login', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = (req.body?.password || '').toString();
  const deviceId = req.body?.deviceId;

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
  }

  claimDeviceAlarms(row.id, deviceId);

  res.json({ token: issueToken(row), user: toPublicUser(row) });
});

// GET /api/auth/me -- Authorization: Bearer <token>
router.get('/me', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return res.status(401).json({ error: 'Giriş yapılmamış.' });

  try {
    const payload = jwt.verify(token, getJwtSecret());
    const row = db.prepare('SELECT id, email FROM users WHERE id = ?').get(payload.sub);
    if (!row) return res.status(401).json({ error: 'Hesap bulunamadı.' });
    res.json({ user: row });
  } catch {
    res.status(401).json({ error: 'Oturum geçersiz veya süresi dolmuş.' });
  }
});

module.exports = router;
