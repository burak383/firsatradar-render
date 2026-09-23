// authMiddleware.js
// -----------------------------------------------------------------------
// "Opsiyonel" auth: bir Authorization: Bearer <token> basligi gelirse ve
// gecerliyse req.user'i doldurur; gelmezse ya da gecersiz/suresi dolmussa
// istegi REDDETMEZ -- sadece req.user tanimsiz kalir ve rota misafir
// (device_id bazli) davranisina geri duser. Boylece /api/alarms gibi
// rotalar hem giris yapmis hem de misafir kullanicilar icin calismaya
// devam eder (bkz. routes/alarms.js).
const jwt = require('jsonwebtoken');
const { getJwtSecret } = require('./authSecret');

function authOptional(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (token) {
    try {
      const payload = jwt.verify(token, getJwtSecret());
      req.user = { id: payload.sub, email: payload.email };
    } catch {
      // gecersiz/suresi dolmus token -- sessizce misafir gibi devam et
    }
  }
  next();
}

module.exports = { authOptional };
