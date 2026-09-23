// authSecret.js
// -----------------------------------------------------------------------
// JWT imzalama anahtari. Kullaniciyi elle bir JWT_SECRET ortam degiskeni
// tanimlamaya zorlamamak icin (bu proje bastan "hic PC/elle mudahale
// gerekmesin" hedefiyle kuruldu -- bkz. render_start.js), tanimli degilse
// rastgele bir anahtar uretip DB dosyasiyla AYNI kalici klasore yaziyoruz.
// Render'da bu klasor kalici diskte (bkz. render_start.js -- DB_PATH oraya
// yonlendiriliyor), yani redeploy/restart sonrasi kaybolmaz; mevcut
// oturumlar (JWT'ler) gecerliligini korur.
//
// Istersen Render panelinden JWT_SECRET ortam degiskeni tanimlayip bu
// otomatik-uretilen anahtari override edebilirsin (opsiyonel, zorunlu
// degil).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DB_PATH } = require('./db');

let cachedSecret = null;

function getJwtSecret() {
  if (cachedSecret) return cachedSecret;

  if (process.env.JWT_SECRET) {
    cachedSecret = process.env.JWT_SECRET;
    return cachedSecret;
  }

  const secretPath = path.join(path.dirname(DB_PATH), 'jwt_secret.txt');
  try {
    if (fs.existsSync(secretPath)) {
      cachedSecret = fs.readFileSync(secretPath, 'utf8').trim();
      if (cachedSecret) return cachedSecret;
    }
    const secret = crypto.randomBytes(48).toString('hex');
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
    cachedSecret = secret;
    return secret;
  } catch (e) {
    // Cok nadir bir durumda (ornegin dosya sistemi salt-okunur) diske
    // yazamazsak, en azindan bu process omrunce gecerli rastgele bir
    // anahtarla devam ederiz -- restart sonrasi tum oturumlar gecersiz
    // olur ama uygulama en azindan calismaya devam eder.
    console.warn(
      '[auth] JWT secret dosyaya yazilamadi -- sadece bu process suresince ' +
        'gecerli bir anahtar kullanilacak (restart sonrasi tum oturumlar gecersiz olur).',
      e.message
    );
    cachedSecret = crypto.randomBytes(48).toString('hex');
    return cachedSecret;
  }
}

module.exports = { getJwtSecret };
