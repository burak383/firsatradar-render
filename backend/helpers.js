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
    activeAlarmCount: alarmCount,
  };
}

module.exports = {
  STORE_META,
  storeMeta,
  discountPercent,
  minutesAgo,
  isLowestIn30Days,
  toDealSummary,
  toDealDetail,
};
