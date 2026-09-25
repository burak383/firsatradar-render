// routes/auth.js
// -----------------------------------------------------------------------
// E-posta + sifre ile kayit/giris. Sifreler asla duz metin tutulmaz
// (bcryptjs ile hash'lenir), giris basariliysa bir JWT dondurulur --
// istemci bunu Authorization: Bearer <token> basligiyla sonraki
// isteklerde gonderir (bkz. authMiddleware.js).
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const appleSignin = require('apple-signin-auth');
const { db, nowIso } = require('../db');
const { getJwtSecret } = require('../authSecret');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TOKEN_TTL = '30d';
const PASSWORD_HASH_ROUNDS = 10;

// app.json > expo.ios.bundleIdentifier ile ayni olmali -- Apple, native
// iOS uygulamalarinda kimlik jetonunun "aud" (audience) alanina tam olarak
// bunu yazar; dogrulama sirasinda eslesmezse jeton reddedilir.
const APPLE_BUNDLE_ID = 'com.firsatradar.app';

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

// POST /api/auth/apple { identityToken, fullName?, deviceId? }
// -----------------------------------------------------------------------
// "Sign in with Apple" -- istemci (Giris.tsx) expo-apple-authentication ile
// Apple'dan bir "identityToken" (imzali JWT) alir, bunu buraya gonderir.
// Biz bu jetonu Apple'in kendi genel anahtarlariyla (apple-signin-auth,
// https://appleid.apple.com/auth/keys) DOGRULARIZ -- istemciden gelen hicbir
// bilgiye (email, isim) dogrudan guvenilmez, sadece jetonun icinden CIKAN
// (ve Apple tarafindan imzalanmis) "sub" ve "email" claim'lerine guvenilir.
//
// "sub" Apple'in bu kullanici icin verdigi kalici, degismeyen kimlik --
// hesabi bulmak/olusturmak icin birincil anahtar bu. E-posta genelde ilk
// girişte gelir (Apple'in "Hide My Email" ozelligiyle bir relay adresi de
// olabilir, sorun degil -- normal bir e-posta gibi calisir); ayni e-postayla
// daha once e-posta/sifre hesabi acilmissa Apple girisini o hesaba baglariz.
router.post('/apple', async (req, res) => {
  const identityToken = (req.body?.identityToken || '').toString();
  const deviceId = req.body?.deviceId;

  if (!identityToken) {
    return res.status(400).json({ error: 'Apple kimlik jetonu eksik.' });
  }

  let payload;
  try {
    payload = await appleSignin.verifyIdToken(identityToken, { audience: APPLE_BUNDLE_ID });
  } catch (e) {
    return res.status(401).json({ error: 'Apple ile giriş doğrulanamadı.' });
  }

  const appleId = payload?.sub;
  if (!appleId) {
    return res.status(401).json({ error: 'Apple ile giriş doğrulanamadı.' });
  }
  const emailFromToken = payload.email ? normalizeEmail(payload.email) : null;

  let row = db.prepare('SELECT * FROM users WHERE apple_id = ?').get(appleId);

  if (!row && emailFromToken) {
    // Ayni e-posta ile daha once e-posta/sifre hesabi acilmissa, Apple
    // girisini o mevcut hesaba bagla -- kullanici iki ayri hesapla
    // karsilasmasin.
    const existingByEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(emailFromToken);
    if (existingByEmail) {
      db.prepare('UPDATE users SET apple_id = ? WHERE id = ?').run(appleId, existingByEmail.id);
      row = { ...existingByEmail, apple_id: appleId };
    }
  }

  if (!row) {
    // Cok nadiren Apple e-posta paylasmayabilir -- bu durumda "sub"a bagli,
    // kararli bir yer tutucu e-posta uretiyoruz (kullanicilar bunu gormez).
    const email = emailFromToken || `apple-${appleId}@appleid.local`;
    // users.password_hash NOT NULL -- Apple hesaplarinda sifreyle giris hic
    // kullanilmayacagi icin rastgele, kimsenin tahmin edemeyecegi bir deger
    // hash'leyip yer tutucu olarak yaziyoruz.
    const randomPassword = crypto.randomBytes(32).toString('hex');
    const passwordHash = await bcrypt.hash(randomPassword, PASSWORD_HASH_ROUNDS);
    const info = db
      .prepare('INSERT INTO users (email, password_hash, apple_id, created_at) VALUES (?, ?, ?, ?)')
      .run(email, passwordHash, appleId, nowIso());
    row = { id: info.lastInsertRowid, email, apple_id: appleId };
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

// POST /api/auth/delete-account { email, password }
// -----------------------------------------------------------------------
// Google Play (ve App Store) uygulamayi yayinlamadan once, hesabi olan
// kullanicilarin -- uygulamayi silseler bile -- hesap silme TALEP
// edebilecekleri herkese acik bir yol istiyor (bkz. legalPages.js'teki
// /hesap-silme sayfasi, bu uca istek atan basit bir web formu). Kimlik
// dogrulamasini JWT yerine e-posta+sifre ile yapiyoruz cunku bu sayfa
// uygulama acik olmadan, tarayicidan da kullanilabilmeli.
//
// Silme GERCEK ve KALICI: hesap ve o hesaba bagli TUM fiyat alarmlari
// veritabanindan tamamen kaldirilir, hicbir yedek/arsiv tutulmaz.
router.post('/delete-account', async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const password = (req.body?.password || '').toString();

  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!row) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
  }
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı.' });
  }

  const deleteAlarms = db.prepare('DELETE FROM alarms WHERE user_id = ?');
  const deleteUser = db.prepare('DELETE FROM users WHERE id = ?');
  db.transaction(() => {
    deleteAlarms.run(row.id);
    deleteUser.run(row.id);
  })();

  res.json({ ok: true });
});

module.exports = router;
