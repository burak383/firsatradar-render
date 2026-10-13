// helpers.js
// Magaza metadata'si + urun satirini API yanitina cevirme yardimcilari.

const STORE_META = {
  trendyol: { label: 'Trendyol', letter: 't' },
  hepsiburada: { label: 'Hepsiburada', letter: 'h' },
  amazon: { label: 'Amazon', letter: 'a' },
  n11: { label: 'N11', letter: 'n' },
  'trendyol-yemek': { label: 'Trendyol Yemek', letter: 'y' },
  lcwaikiki: { label: 'LC Waikiki', letter: 'l' },
  defacto: { label: 'Defacto', letter: 'd' },
  boyner: { label: 'Boyner', letter: 'b' },
  koton: { label: 'Koton', letter: 'k' },
  ciceksepeti: { label: 'Çiçeksepeti', letter: 'ç' },
  morhipo: { label: 'Morhipo', letter: 'm' },
  pttavm: { label: 'PTT AVM', letter: 'p' },
};

function storeMeta(store) {
  return STORE_META[store] || { label: store, letter: store.slice(0, 1) };
}

function discountPercent(currentPrice, oldPrice) {
  if (!oldPrice || oldPrice <= currentPrice) return null;
  return Math.round(((oldPrice - currentPrice) / oldPrice) * 100);
}

function minutesAgo(isoString) {
  if (!isoString) return null;
  const diffMs = Date.now() - new Date(isoString).getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}

// Son 30 gunun (price_history + guncel fiyat) en dusugu, guncel fiyata
// esit veya ondan daha yuksekse "bu fiyat 30 gunun dibi" diyebiliriz.
function isLowestIn30Days(db, productId, currentPrice) {
  const row = db
    .prepare(
      `SELECT MIN(price) AS minPrice FROM price_history
       WHERE product_id = ? AND checked_at >= datetime('now', '-30 days')`
    )
    .get(productId);
  if (!row || row.minPrice == null) return true;
  return currentPrice <= row.minPrice;
}

// --- Fiyat analizi ("gercek indirim kontrolu") -------------------------
// Urunun GOZLEMLENEN fiyat gecmisinden (price_history) son `windowDays`
// gundeki zaman-agirlikli ortalama / en dusuk / en yuksek fiyati hesaplar
// ve guncel fiyatin bu referansa gore gercekten indirimli olup olmadigini
// soyler. price_history'ye nokta SADECE fiyat degistiginde eklendigi icin
// (bkz. import_telegram_signals.js) her nokta, bir sonraki nokta gelene
// kadar gecerli kabul edilir (zaman-agirlikli ortalama; basit ortalama
// degil, aksi halde uzun sure ayni kalan bir fiyat az sayilirdi).
//
// ONEMLI: products.old_price Telegram mesajindaki yuzdeden tahmin edilmis
// olabilir (impliedOldPrice) -- yani magaza/kanal iddiasidir, gozlem
// degildir. Bu yuzden "eski fiyat" gozlemledigimiz en yuksek fiyattan
// belirgin sekilde yuksekse `claimedOldPriceUnverified` isaretlenir ve
// uygulama "belirtilen eski fiyat dogrulanamadi" uyarisi gosterir.
const DAY_MS = 24 * 3600 * 1000;

function computePriceAnalysis(db, row, windowDays = 90) {
  const now = Date.now();
  const sinceMs = now - windowDays * DAY_MS;
  const sinceIso = new Date(sinceMs).toISOString();

  const inWindow = db
    .prepare(
      `SELECT price, checked_at FROM price_history
       WHERE product_id = ? AND checked_at >= ? ORDER BY checked_at ASC`
    )
    .all(row.id, sinceIso);
  // Pencereden hemen onceki son gozlem de pencereye girer: o fiyat pencere
  // basladiginda hala gecerliydi.
  const before = db
    .prepare(
      `SELECT price, checked_at FROM price_history
       WHERE product_id = ? AND checked_at < ? ORDER BY checked_at DESC LIMIT 1`
    )
    .get(row.id, sinceIso);

  const observations = [];
  if (before) observations.push({ price: before.price, t: sinceMs, real: Date.parse(before.checked_at) });
  for (const h of inWindow) {
    const t = Date.parse(h.checked_at);
    observations.push({ price: h.price, t, real: t });
  }

  const base = {
    windowDays,
    observationCount: observations.length,
    trackedDays: null,
    minPrice: null,
    maxPrice: null,
    avgPrice: null,
    pctVsAverage: null,
    positionInRange: null,
    verdict: 'insufficient',
    confidence: 'low',
    claimedOldPriceUnverified: false,
  };

  if (observations.length < 2) {
    // Tek gozlem: referans yok. Magaza iddiasi (old_price) varsa onu
    // "dogrulanmadi" olarak isaretle ki kullanici bunu kesin gercek sanmasin.
    base.claimedOldPriceUnverified = row.old_price != null && row.old_price > row.current_price;
    return base;
  }

  const prices = observations.map((o) => o.price);
  const minPrice = Math.min(...prices, row.current_price);
  const maxPrice = Math.max(...prices, row.current_price);

  // Zaman-agirlikli ortalama: her fiyat, bir sonraki gozleme (sonuncu icin
  // "simdi"ye) kadar gecerli.
  let weighted = 0;
  let totalMs = 0;
  for (let i = 0; i < observations.length; i++) {
    const start = observations[i].t;
    const end = i + 1 < observations.length ? observations[i + 1].t : now;
    const span = Math.max(0, end - start);
    weighted += observations[i].price * span;
    totalMs += span;
  }
  const avgPrice =
    totalMs > 0 ? weighted / totalMs : prices.reduce((a, b) => a + b, 0) / prices.length;

  const firstReal = Math.min(...observations.map((o) => o.real));
  const trackedDays = Math.max(0, (now - firstReal) / DAY_MS);

  const pctVsAverage = Math.round(((row.current_price - avgPrice) / avgPrice) * 100);
  const positionInRange =
    maxPrice > minPrice
      ? Math.round(((maxPrice - row.current_price) / (maxPrice - minPrice)) * 100)
      : null;

  let verdict;
  if (row.current_price <= avgPrice * 0.9) verdict = 'real_deal';
  else if (row.current_price >= avgPrice * 1.05) verdict = 'above_average';
  else verdict = 'normal';

  // En az 2 gozlem zaten var (yukarida kontrol edildi); price_history'ye
  // sadece fiyat degistiginde nokta eklendigi icin 2 nokta uzun bir sureyi
  // kapsayabilir -- guven olcusu bu yuzden nokta sayisina degil, ne kadar
  // suredir takip ettigimize bagli. 7 gunden kisa ise "dusuk guven".
  const confidence = trackedDays >= 7 ? 'ok' : 'low';

  const claimedOldPriceUnverified =
    row.old_price != null &&
    row.old_price > row.current_price &&
    row.old_price > maxPrice * 1.05;

  return {
    windowDays,
    observationCount: observations.length,
    trackedDays: Math.round(trackedDays),
    minPrice: Math.round(minPrice),
    maxPrice: Math.round(maxPrice),
    avgPrice: Math.round(avgPrice),
    pctVsAverage,
    positionInRange,
    verdict,
    confidence,
    claimedOldPriceUnverified,
  };
}

function toDealSummary(db, row) {
  const meta = storeMeta(row.store);
  return {
    id: row.id,
    title: row.title,
    brand: row.brand,
    category: row.category,
    store: row.store,
    storeLabel: meta.label,
    storeLetter: meta.letter,
    storeUrl: row.store_url,
    imageUrl: row.image_url,
    currentPrice: row.current_price,
    oldPrice: row.old_price,
    currency: row.currency,
    discountPercent: discountPercent(row.current_price, row.old_price),
    stockStatus: row.stock_status,
    isFlashDeal: !!row.is_flash_deal,
    flashDealEndsAt: row.flash_deal_ends_at,
    isLowest30d: isLowestIn30Days(db, row.id, row.current_price),
    followCount: row.follow_count,
    verifiedMinutesAgo: minutesAgo(row.verified_at),
  };
}

function toDealDetail(db, row) {
  const summary = toDealSummary(db, row);
  const history = db
    .prepare(
      `SELECT price, checked_at FROM price_history
       WHERE product_id = ? ORDER BY checked_at ASC`
    )
    .all(row.id)
    .map((h) => ({ price: h.price, checkedAt: h.checked_at }));

  const alarmCount = db
    .prepare('SELECT COUNT(*) AS c FROM alarms WHERE product_id = ? AND active = 1')
    .get(row.id).c;

  return {
    ...summary,
    couponCode: row.coupon_code,
    priceHistory: history,
    priceAnalysis: computePriceAnalysis(db, row),
    activeAlarmCount: alarmCount,
  };
}

module.exports = {
  STORE_META,
  storeMeta,
  discountPercent,
  minutesAgo,
  isLowestIn30Days,
  computePriceAnalysis,
  toDealSummary,
  toDealDetail,
};
