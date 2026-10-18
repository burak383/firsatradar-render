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

# "2500/500", "2.500/500 TL", "₺2500/500" gibi egik cizgiyle ayrilmis
# eski/yeni fiyat ciftini yakalar. (?<![\d/]) / (?![\d/]) sinirlari,
# "12/500/300" gibi uc parcali bir zincirin ortasindan yanlislikla
# eslesmeyi engeller.
SLASH_PRICE_RE = re.compile(
    r"""
    (?<![\d/])
    (?P<currency_pre>₺)?\s*
    (?P<old>\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)
    \s*/\s*
    (?P<new>\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)
    (?![\d/])
    \s*
    (?P<currency_post>TL|₺|lira)?
    """,
    re.IGNORECASE | re.VERBOSE,
)

URL_RE = re.compile(r"https?://\S+")


# --- Tutar baglam siniflandirmasi -------------------------------------------
# Eskiden metindeki para birimli EN DUSUK tutar "fiyat" sayiliyordu. Oysa
# kanallar sik sik "Sepette 1.000 TL indirim", "7.500 TL'ye 750 TL indirim
# kodu", "12 x 708 TL taksit", "adet basi 22 TL" gibi, URUN FIYATI OLMAYAN
# tutarlar da yaziyor. Bu tutarlar urunun gercek fiyatindan kucuk oldugu icin
# "en dusuk tutar" kurali onlari fiyat sanip %97-100 indirimli sahte urunler
# (ör. 100.000 TL'lik telefon 1.000 TL) uretiyordu. Her tutarin ONCESINDEKI/
# SONRASINDAKI kelimelere bakarak bunlari ayiklariz. Tum karsilastirmalar
# _tr_lower() ile kucultulmus metin uzerinde yapilir.


def _tr_lower(s: str) -> str:
    """Turkce buyuk/kucuk harf: 'İ'->'i', 'I'->'ı'. Karakter sayisini
    degistirmez, boylece kucultulmus metindeki indeksler orijinaliyle ayni kalir."""
    return s.replace("İ", "i").replace("I", "ı").lower()


# Tutardan SONRA gelirse "indirim tutari / kupon / kargo vb." demektir.
# "indirimli/indirimsiz" haric: "8.499 TL indirimli fiyat" gercek fiyattir.
_NON_PRICE_AFTER_RE = re.compile(
    r"""^\s*(?:tl|₺|lira)?\s*(?:['’]\s*(?:lik|lık|luk|lük))?\s*
        (?:ek\s+|ilave\s+|extra\s+)?
        (?:indirim(?!li|siz)|kupon|hediye|çeki|ceki|puan|iade|cashback|bonus|ödül|ödul)""",
    re.VERBOSE,
)
# Tutardan ONCE gelirse ("indirim: 500 TL", "kupon 200 TL", "kargo 25 TL").
_NON_PRICE_BEFORE_RE = re.compile(
    r"(?:(?:indirim|puan)\s*(?:tutarı|tutari)?\s*[:\-–=]\s*|(?:kupon|kod|hediye\s*çeki|cashback|kargo|taksit|ödül)\s*(?:tutarı|tutari)?\s*[:\-–=]?\s*)$"
)
# Taksit: "12 x 708 TL", "708 TL x 12", "708 TL 12 ay/taksit".
_INSTALLMENT_BEFORE_RE = re.compile(r"\d+\s*[x×]\s*$")
_INSTALLMENT_AFTER_RE = re.compile(r"^\s*(?:tl|₺)?\s*(?:[x×]\s*\d+|\d+\s*(?:ay|taksit)|taksit)")
# Esik tutar: "7.500 TL ve uzeri", "2.500₺ ve Uzerine", "500 TL'ye 100 TL indirim".
_THRESHOLD_AFTER_RE = re.compile(
    r"""^\s*(?:tl|₺)?\s*(?:
        ['’]?\s*(?:ye|ya|e|a|ile)?\s*(?:ve\s+)?(?:üzeri|üstü|uzeri|ustu)
        |['’](?:ye|ya|e|a)\s+[₺\d]
        |['’]\s*(?:ye|ya|e|a)?\s*(?:ve\s+)?(?:alışveriş|alisveris|sipariş|siparis|sepet)
    )""",
    re.VERBOSE,
)
# Birim fiyat: "22 TL/adet", "adet basi 22 TL", "100 gr fiyati".
_UNIT_AFTER_RE = re.compile(
    r"^\s*(?:tl|₺)?\s*(?:/\s*(?:adet|kg|lt|l|gr|g|ml|metre|m)\b|adet\s*başı|adet\s*basi|başına|basina|tanesi|tanesine|birim)"
)
_UNIT_BEFORE_RE = re.compile(r"(?:adet\s*başı|adet\s*basi|birim\s*fiyat[ıi]?|tanesi|kg\s*fiyat[ıi])\s*[:\-–]?\s*$")

# Mesaj bir URUN degil, kupon / kampanya duyurusuysa (fiyat adayi kalmadiysa
# ve bu kaliplardan biri varsa) urun olarak kaydedilmez.
_COUPON_RE = re.compile(
    r"""indirim\s*(?:kodu|kuponu|kupon|çeki|ceki)|\bkupon|hediye\s*çeki|promosyon\s*kodu
        |kodu?\s+(?:ile|aktif|girin|kullan)
        |(?:ve\s+)?(?:üzeri|üstü|uzeri|ustu)\s+(?:alışveriş|alisveris|sipariş|siparis|sepet)
        |alışverişlerinizde|alisverislerinizde|alışverişinizde|alisverisinizde
        |ve\s+(?:üzerine|üstüne|uzerine|ustune)\b""",
    re.VERBOSE,
)


def _classify_amount(lowered: str, start: int, end: int) -> str:
    """Bir tutarin urun fiyati mi yoksa baska bir sey mi oldugunu baglamdan
    tahmin eder. 'price' disindaki her sonuc fiyat adayi sayilmaz."""
    # Sadece AYNI SATIRDAKI baglama bak: "7.899 TL\nKupon: 200 TL" gibi
    # alt satirdaki kelime ustteki fiyati etkilemesin.
    before = lowered[max(0, start - 28):start].split("\n")[-1]
    after = lowered[end:end + 48].split("\n")[0]
    if _INSTALLMENT_BEFORE_RE.search(before) or _INSTALLMENT_AFTER_RE.match(after):
        return "installment"
    if _NON_PRICE_AFTER_RE.match(after) or _NON_PRICE_BEFORE_RE.search(before):
        return "discount_amount"
    if _THRESHOLD_AFTER_RE.match(after):
        return "threshold"
    if _UNIT_AFTER_RE.match(after) or _UNIT_BEFORE_RE.search(before):
        return "unit"
    return "price"


# Iki fiyattan kucugu buyugunun bu oranindan azsa (ör. 1.000 TL / 100.000 TL)
# kucuk olan buyuk ihtimalle kupon/indirim tutaridir, urun fiyati degildir.
MIN_PLAUSIBLE_PRICE_RATIO = 0.15
# %85'ten buyuk "indirim" gercek bir urun indirimi degil, parse hatasidir.
MAX_PLAUSIBLE_DISCOUNT_PERCENT = 85

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
    # Mesaj bir urun degil, kupon / kampanya duyurusu (ör. "7.500 TL'ye 750 TL
    # indirim kodu"). True ise looks_like_offer False doner.
    is_coupon: bool = False

    @property
    def looks_like_offer(self) -> bool:
        """En az fiyat VEYA indirim yuzdesi + bir link varsa 'aday firsat' sayariz.
        Kupon/kampanya duyurulari urun degildir, aday sayilmaz."""
        if self.is_coupon:
            return False
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


def _strip_urls(text: str) -> str:
    """SLASH_PRICE_RE'yi linklerden korumak icin kullanilir -- 't.me/kanal/
    123/456' gibi bir URL'nin yol parcalari egik cizgili bir fiyat ciftiyle
    (orn. "123/456") karistirilmasin diye once linkleri metinden cikarir.
    """
    return URL_RE.sub(" ", text)


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
            pct = int(disc_match.group("percent"))
            # %85'ten buyuk degerler gercek indirim degil (parse hatasi ya da
            # ilgisiz bir yuzde) -- yok say.
            if 0 < pct <= MAX_PLAUSIBLE_DISCOUNT_PERCENT:
                offer.discount_percent = pct
        except (TypeError, ValueError):
            pass

    lowered = _tr_lower(text)

    # Fiyat -- metindeki TUM eslesmeleri bul, en "makul" olani sec.
    # "Eski fiyat X / Yeni fiyat Y" gibi mesajlarda bizi ilgilendiren
    # GUNCEL (dusuk) fiyattir, o yuzden para birimi belirtilen eslesmeler
    # arasindan EN DUSUK olani seciyoruz. Para birimsiz hicbir eslesme
    # yoksa, ilk gecerli (yil olmayan) sayiyi dusuk guvenle kullaniyoruz.
    currency_matches = []
    plain_matches = []
    # URL'ler icindeki rakamlar (n11.com, /p-12345 vb.) fiyat sanilmasin: ayni
    # uzunlukta bosluklarla degistirip indeksleri koru.
    price_scan_text = URL_RE.sub(lambda u: " " * len(u.group(0)), text)
    rejected_kinds = []
    for m in PRICE_RE.finditer(price_scan_text):
        amount = _to_float(m.group("amount"))
        has_currency = bool(m.group("currency_pre") or m.group("currency_post"))
        if amount != amount:  # NaN kontrolu
            continue
        # Indirim tutari / kupon / esik / taksit / birim fiyat gibi URUN FIYATI
        # OLMAYAN tutarlari ele (bkz. _classify_amount).
        amount_end = m.end("currency_post") if m.group("currency_post") else m.end("amount")
        kind = _classify_amount(lowered, m.start("amount"), amount_end)
        if kind != "price":
            if has_currency:
                rejected_kinds.append(kind)
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
    elif plain_matches and not rejected_kinds:
        # Para birimli tutarlar vardi ama hepsi indirim/esik/taksit idiyse,
        # kalan para birimsiz sayilar (marka adi "N11", model no) fiyat degildir.
        m, amount = plain_matches[0]
        best_match = (m, False, amount)

    # SLASH_PRICE_RE asagida bu degeri kullanacak: eger fiyat SADECE zayif
    # bir "para birimsiz ilk sayi" tahminiyle bulunduysa (currency_matches
    # bos, plain_matches[0] gibi -- ornegin "Note 13" gibi bir model
    # numarasi bile olabilir), egik cizgili net bir fiyat cifti bulunursa
    # onun ezmesine izin veriyoruz. Gercek bir para birimli eslesme
    # (currency_matches) zaten guvenilir oldugu icin ona dokunmuyoruz.
    price_is_weak_guess = not bool(currency_matches)

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
            if low / high < MIN_PLAUSIBLE_PRICE_RATIO:
                # Ör. 100.000 TL ve 1.000 TL: kucuk olan buyuk ihtimalle bir
                # kupon/indirim tutari (baglam kelimesi yazilmamis) -- urun
                # fiyati buyuk olandir, indirim yuzdesi uydurma.
                offer.price_amount = high
            else:
                computed = round((high - low) / high * 100)
                if 0 < computed <= MAX_PLAUSIBLE_DISCOUNT_PERCENT:
                    offer.discount_percent = computed

    # "2500/500" gibi egik cizgiyle ayrilmis eski/yeni fiyat ciftini de
    # indirim sinyali sayiyoruz (yukaridaki iki-ayri-fiyat-eslesmesi
    # mantigi bunu yakalamaz, cunku burada TEK bir eslesme icinde iki
    # sayi var). Linkler icindeki sayisal yol parcalarindan ("t.me/
    # kanal/123/456") yanlislikla tetiklenmesin diye linkleri cikarilmis
    # metin uzerinde ariyoruz. "23/09" gibi bir tarihle karismasin diye
    # eski fiyatin makul bir tutar (>=50) olmasini ve eski > yeni
    # olmasini sartiyoruz.
    stripped = _strip_urls(text)
    slash_match = SLASH_PRICE_RE.search(stripped)
    if slash_match:
        old_val = _to_float(slash_match.group("old"))
        new_val = _to_float(slash_match.group("new"))
        slash_after = _tr_lower(stripped)[slash_match.end():slash_match.end() + 48]
        # "7500/750 Indirim Kodu" gibi bir kupon yazimi eski/yeni fiyat cifti
        # degildir; ayrica iki sayi arasindaki oran asiri uc ise (>%85 indirim)
        # bu da fiyat cifti degil kupon tutaridir.
        slash_is_coupon = bool(_NON_PRICE_AFTER_RE.match(slash_after)) or bool(
            _COUPON_RE.search(slash_after)
        )
        if (
            old_val == old_val and new_val == new_val and old_val > new_val >= 1 and old_val >= 50
            and not slash_is_coupon
            and new_val / old_val >= MIN_PLAUSIBLE_PRICE_RATIO
        ):
            if offer.price_amount is None or price_is_weak_guess:
                offer.price_amount = new_val
                offer.price_currency = "TRY"
                offer.product_guess = _guess_product_name(text, slash_match.span())
            if offer.discount_percent is None:
                computed = round((old_val - new_val) / old_val * 100)
                if 0 < computed <= MAX_PLAUSIBLE_DISCOUNT_PERCENT:
                    offer.discount_percent = computed

    # Fiyat adayi hic kalmadiysa ve mesaj kupon/kampanya diliyle yaziliysa bu
    # bir URUN degil, kupon duyurusudur -- urun olarak kaydedilmesin.
    if offer.price_amount is None and (
        _COUPON_RE.search(lowered)
        or any(k in ("discount_amount", "threshold") for k in rejected_kinds)
    ):
        offer.is_coupon = True

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
