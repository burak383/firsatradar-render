// pushNotifications.js
// -----------------------------------------------------------------------
// Expo push bildirimlerini gonderen kucuk bir yardimci. Expo'nun kendi
// "expo-server-sdk" paketi Node >=22.12 istiyor (bu projenin Dockerfile'i
// node:20-slim kullaniyor -- bkz. Dockerfile), bu yuzden ekstra bir
// bagimlilik eklemek yerine dogrudan Expo'nun push HTTP API'sine
// (https://exp.host/--/api/v2/push/send) Node 20'nin yerlesik fetch'iyle
// istek atiyoruz. Tek is: bir jeton listesine bildirim gondermek, gecersiz
// jetonlari (DeviceNotRegistered) push_tokens tablosundan temizlemek, ve
// HERHANGI bir hata durumunda sessizce devam etmek -- bu fonksiyon
// import_telegram_signals.js icindeki ana veri aktarimini asla
// durdurmamali/coktürmemeli.
//
// Kullanim:
//   const { sendPushNotifications } = require('./pushNotifications');
//   await sendPushNotifications([
//     { to: 'ExponentPushToken[xxx]', title: '...', body: '...', data: {...} },
//   ]);

const { db } = require('./db');

// Testlerde/yerel gelistirmede gercek Expo servisine istek atmadan
// dogrulama yapabilmek icin env degiskeniyle override edilebilir.
const EXPO_PUSH_URL = process.env.EXPO_PUSH_URL || 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100; // Expo'nun onerdigi ust sinir

function isLikelyExpoPushToken(value) {
  return typeof value === 'string' && /^Expo(nent)?PushToken\[.+\]$/.test(value.trim());
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

function removeToken(token) {
  try {
    db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
  } catch (e) {
    console.error('[push] Gecersiz jeton silinemedi:', e.message);
  }
}

// messages: [{ to, title, body, data? }]. Gecersiz formatli "to" degerleri
// sessizce atlanir (kayit hatasi degil, savunma amacli).
async function sendPushNotifications(messages) {
  const valid = messages.filter((m) => isLikelyExpoPushToken(m.to));
  if (valid.length === 0) return { sent: 0, removed: 0 };

  let sent = 0;
  let removed = 0;

  for (const batch of chunk(valid, CHUNK_SIZE)) {
    let json;
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          batch.map((m) => ({
            to: m.to,
            title: m.title,
            body: m.body,
            data: m.data || {},
            sound: 'default',
          }))
        ),
      });
      json = await res.json();
    } catch (e) {
      console.error('[push] Expo push istegi basarisiz:', e.message);
      continue; // bu batch'i atla, digerlerine devam et
    }

    const tickets = Array.isArray(json?.data) ? json.data : [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'ok') {
        sent += 1;
      } else {
        // "DeviceNotRegistered" -- uygulama kaldirilmis/jeton gecersiz.
        if (ticket.details?.error === 'DeviceNotRegistered') {
          removeToken(batch[i].to);
          removed += 1;
        } else {
          console.error('[push] Bildirim gonderilemedi:', ticket.message || ticket);
        }
      }
    });
  }

  return { sent, removed };
}

module.exports = { sendPushNotifications, isLikelyExpoPushToken };
