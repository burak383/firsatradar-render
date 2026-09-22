"""
parser.py
---------
Telegram indirim kanali mesajlarindan urun adi, fiyat ve link cikaran
basit regex tabanli ayiklayici.

Bu bir "ilk versiyon" sezgiseldir; kanal formatlari birbirinden farkli
oldugu icin %100 dogru calismaz. Amac, dogru fiyat/urun bilgisini
mağaza tarafinda dogrulamak icin bir *aday* cikarmaktir -- nihai
gercek kaynagi her zaman magaza/affiliate feed olmalidir.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional


# Turkce lira formatlarini yakalar: 599 TL, 1.234,56 TL, ₺599, 599₺, 599,90 TL
# (?<!\d) / (?!\d) sinirlari: "2026" gibi bir sayinin ortasindan yanlislikla
# parca (orn. "202") yakalanmasini engeller.
PRICE_RE = re.compile(
    r"""
    (?<!\d)
    (?P<currency_pre>₺)?\s*
    (?P<amount>
        \d{1,3}(?:\.\d{3})*(?:,\d{1,2})?   # 1.234,56  veya 1234
        |
        \d+(?:,\d{1,2})?                    # 599  veya 599,90
    )
    (?!\d)
    \s*
    (?P<currency_post>TL|₺|lira)?
    """,
    re.IGNORECASE | re.VERBOSE,
)

# "yuzde X indirim", "%X indirim", "X TL indirim"
DISCOUNT_RE = re.compile(
    r"(%|\byuzde\b|\bYÜZDE\b)\s*(?P<percent>\d{1,3})\s*(indirim|dustu|düştü)?",
    re.IGNORECASE,
)

URL_RE = re.compile(r"https?://\S+")

# Bilinen kisa link / yonlendirme domainleri (affiliate linkleri de dahil)
KNOWN_SHOP_DOMAINS = (
    "trendyol.com", "ty.gl",
    "hepsiburada.com", "hb.biz", "hepsiburada.net",
    "n11.com",
    "ciceksepeti.com",
    "epttavm.com",
    "amazon.com.tr", "amzn.to",
)


@dataclass
class ParsedOffer:
    raw_text: str
    product_guess: Optional[str] = None
    price_amount: Optional[float] = None
    price_currency: Optional[str] = None
    discount_percent: Optional[int] = None
    links: list[str] = field(default_factory=list)
    shop_links: list[str] = field(default_factory=list)

    @property
    def looks_like_offer(self) -> bool:
        """En az fiyat VEYA indirim yuzdesi + bir link varsa 'aday firsat' sayariz."""
        has_signal = self.price_amount is not None or self.discount_percent is not None
        return has_signal and bool(self.links)


def _to_float(amount_str: str) -> float:
    """'1.234,56' -> 1234.56, '12.999' -> 12999.0, '599,90' -> 599.90, '599' -> 599.0

    Regex tasarimi geregi '.' HER ZAMAN binlik ayiraci olarak yakalanir
    (ondalik nokta yakalanmaz), bu yuzden once nokta kaldirilir, sonra
    varsa virgul ondalik ayiraci olarak noktaya cevrilir.
    """
    s = amount_str.strip()
    if "." in s:
        s = s.replace(".", "")
    if "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return float("nan")


def _clean_candidate(s: str) -> str:
    """URL'leri ve fazla noktalama/emoji'yi temizler."""
    s = URL_RE.sub("", s)
    s = re.sub(r"^[^\wÇĞİÖŞÜçğıöşü]+", "", s)
    s = re.sub(r"[-:|!]+$", "", s)
    return s.strip()


def _guess_product_name(text: str, price_span: Optional[tuple[int, int]]) -> Optional[str]:
    """
    Cok satirli mesajlarda (tipik format: "Urun Adi\nEski fiyat...\nYeni fiyat...")
    ilk satir genelde urun adidir -> onu tercih et.

    Tek satirli mesajlarda (urun adi + fiyat + link hepsi ayni satirda)
    fiyattan ONCEKI metni urun adi olarak dene, cunku ilk satir = tum
    mesaj olur ve kullanissiz uzun bir tahmine donusur.

    Bu bir sezgiseldir, garanti degildir -- kanal formatlari cok cesitli.
    """
    is_multiline = "\n" in text.strip()

    def first_line_candidate() -> Optional[str]:
        first_line = text.strip().splitlines()[0] if text.strip() else ""
        candidate = _clean_candidate(first_line)
        return candidate[:200] if len(candidate) >= 6 else None

    def before_price_candidate() -> Optional[str]:
        if not price_span:
            return None
        before = text[: price_span[0]]
        before_line = before.splitlines()[-1] if before else ""
        candidate = _clean_candidate(before_line)
        return candidate[:200] if len(candidate) >= 6 else None

    if is_multiline:
        return first_line_candidate() or before_price_candidate()
    return before_price_candidate() or first_line_candidate()


def parse_message(text: str) -> ParsedOffer:
    if not text:
        return ParsedOffer(raw_text="")

    offer = ParsedOffer(raw_text=text)

    # Linkler
    offer.links = URL_RE.findall(text)
    offer.shop_links = [
        u for u in offer.links if any(d in u.lower() for d in KNOWN_SHOP_DOMAINS)
    ]

    # Indirim yuzdesi
    disc_match = DISCOUNT_RE.search(text)
    if disc_match:
        try:
            offer.discount_percent = int(disc_match.group("percent"))
        except (TypeError, ValueError):
            pass

    # Fiyat -- metindeki TUM eslesmeleri bul, en "makul" olani sec.
    # "Eski fiyat X / Yeni fiyat Y" gibi mesajlarda bizi ilgilendiren
    # GUNCEL (dusuk) fiyattir, o yuzden para birimi belirtilen eslesmeler
    # arasindan EN DUSUK olani seciyoruz. Para birimsiz hicbir eslesme
    # yoksa, ilk gecerli (yil olmayan) sayiyi dusuk guvenle kullaniyoruz.
    currency_matches = []
    plain_matches = []
    for m in PRICE_RE.finditer(text):
        amount = _to_float(m.group("amount"))
        has_currency = bool(m.group("currency_pre") or m.group("currency_post"))
        if amount != amount:  # NaN kontrolu
            continue
        if not has_currency and (amount < 1 or amount > 999999):
            continue
        if not has_currency and amount == int(amount) and len(m.group("amount")) == 4:
            # 2024, 2026 gibi yil olabilecek 4 haneli, para birimsiz sayilari atla
            continue
        if not has_currency:
            # "%45 indirim" gibi bir yuzde ifadesinin rakamini para birimsiz
            # bir "fiyat" sanmayalim -- hemen oncesinde (bosluk atlanarak)
            # '%' varsa bu bir yuzdedir, fiyat degildir.
            before = text[: m.start()].rstrip()
            if before.endswith("%"):
                continue
        (currency_matches if has_currency else plain_matches).append((m, amount))

    best_match = None
    if currency_matches:
        m, amount = min(currency_matches, key=lambda pair: pair[1])
        best_match = (m, True, amount)
    elif plain_matches:
        m, amount = plain_matches[0]
        best_match = (m, False, amount)

    if best_match:
        m, _, amount = best_match
        offer.price_amount = amount
        offer.price_currency = "TRY"
        offer.product_guess = _guess_product_name(text, m.span())
    else:
        offer.product_guess = _guess_product_name(text, None)

    # Bazi kanallar "Eski fiyat 12.999 TL / Yeni fiyat 8.499 TL" gibi iki
    # fiyati yan yana yazar ama yuzdeyi ayrica belirtmez (yukaridaki
    # DISCOUNT_RE hicbir sey yakalamaz). Bu durumda mesaj gercekte bir
    # indirim bildiriyor olsa da discount_percent bos kalir, urun geri
    # ucta "indirim"siz duz bir fiyat gibi kaydedilir. Tam olarak IKI
    # para birimli fiyat eslesmesi varsa (daha fazlasi -- birden fazla
    # urun/kargo ucreti gibi belirsiz durumlar -- icin bu tahmine
    # girmiyoruz), en yuksegini "eski fiyat" sayip yuzdeyi kendimiz
    # turetelim.
    if offer.discount_percent is None and len(currency_matches) == 2:
        amounts = sorted(a for _, a in currency_matches)
        low, high = amounts[0], amounts[1]
        if low == offer.price_amount and high > low > 0:
            computed = round((high - low) / high * 100)
            if 0 < computed < 100:
                offer.discount_percent = computed

    return offer


def add_links(offer: ParsedOffer, extra_urls: list[str]) -> None:
    """Mesaj METNI disindan (ornegin Telegram'in inline 'Satin Al' butonundan)
    gelen linkleri offer'a ekler.

    Cogu firsat kanali linki mesaj metnine yazmiyor, fotografin altina
    tiklamali bir buton olarak ekliyor -- bu durumda event.raw_text bos
    kalir ve looks_like_offer (fiyat VAR ama link YOK sandigi icin) yanlislikla
    False donerdi. listener.py, Telethon'un event.message.buttons alanindan
    bu url'leri cikarip burada offer'a ekliyor.
    """
    for u in extra_urls:
        if u not in offer.links:
            offer.links.append(u)
        if any(d in u.lower() for d in KNOWN_SHOP_DOMAINS) and u not in offer.shop_links:
            offer.shop_links.append(u)


if __name__ == "__main__":
    samples = [
        "🔥 Xiaomi Redmi Note 13 128GB\nEski fiyat 12.999 TL\nYeni fiyat 8.499 TL (%35 indirim)\nhttps://ty.gl/abc123",
        "Philips Airfryer 4.1L sadece 1.899,90 TL! https://www.hepsiburada.com/urun-xyz",
        "Bugun kanalimizda 2026 model urunler var, link bio'da.",
    ]
    for s in samples:
        result = parse_message(s)
        print("-" * 40)
        print("Metin      :", s.splitlines()[0])
        print("Urun tahmini:", result.product_guess)
        print("Fiyat       :", result.price_amount, result.price_currency)
        print("Indirim %   :", result.discount_percent)
        print("Magaza linki:", result.shop_links)
        print("Firsat mi?  :", result.looks_like_offer)
