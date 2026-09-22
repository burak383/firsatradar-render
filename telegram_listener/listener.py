"""
listener.py
-----------
Belirtilen herkese acik Telegram kanallarini MTProto (Telethon) ile
GERCEK ZAMANLI dinler, yeni mesaj geldigi anda parser.py ile ayiklar
ve db.py araciligiyla SQLite'a yazar.

DAYANIKLILIK (internet kesintileri): Telegram bulut tabanli bir servis
oldugu icin internet OLMADAN yeni mesaj cekmek mumkun degil -- ama
internet KISA SURELI kesilirse (wifi dususu, uyku modundan cikis vb.)
hicbir mesaj kalici olarak kaybolmaz:
  1) Telethon, baglanti koptugunda varsayilan olarak kendiliginden
     yeniden baglanmayi dener (connection_retries).
  2) Bu sirada KACIRILAN mesajlar icin: baslangicta VE her birkac
     dakikada bir (bkz. periodic_catch_up), her kanalin SON birkac
     mesaji Telegram'in kendi gecmisinden yeniden cekilip islenir.
     Ayni mesaj daha once kaydedildiyse (message_exists) atlanir, bu
     yuzden bu tarama guvenle surekli tekrarlanabilir.

Ilk calistirmada telefon numarani ve Telegram'dan gelen kodu (varsa 2FA
sifreni) soracak; bu sadece bir kere olur, sonrasinda TG_SESSION_NAME
ile ayni klasorde bir .session dosyasi olusur ve tekrar giris istenmez.

Kullanim:
    python listener.py

Durdurmak icin: Ctrl+C
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

from dotenv import load_dotenv
from telethon import TelegramClient, events

from db import init_db, insert_message, message_exists
from parser import add_links, parse_message

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("listener")


def load_config():
    load_dotenv()

    def _require(name: str) -> str:
        val = os.getenv(name)
        if not val:
            log.error(
                "%s tanimli degil. .env.example dosyasini .env olarak kopyalayip doldurun.",
                name,
            )
            sys.exit(1)
        return val

    api_id = _require("TG_API_ID")
    api_hash = _require("TG_API_HASH")
    session_name = os.getenv("TG_SESSION_NAME", "firevibe_watcher")
    channels_raw = _require("TG_CHANNELS")
    channels = [c.strip().lstrip("@") for c in channels_raw.split(",") if c.strip()]
    db_path = os.getenv("DB_PATH", "./data/messages.db")
    # Urun fotograflari dogrudan backend'in statik olarak servis ettigi
    # klasore indirilir (bkz. backend/server.js -- /telegram-images route'u)
    # ki import_telegram_signals.js ekstra bir kopyalama yapmadan URL
    # uretebilsin. Bos birakilirsa gorsel indirme atlanir.
    image_dir = os.getenv("TG_IMAGE_DIR", "").strip() or None

    try:
        api_id_int = int(api_id)
    except ValueError:
        log.error("TG_API_ID sayisal olmali (my.telegram.org/apps sayfasindaki App api_id).")
        sys.exit(1)

    return {
        "api_id": api_id_int,
        "api_hash": api_hash,
        "session_name": session_name,
        "channels": channels,
        "db_path": db_path,
        "image_dir": image_dir,
    }


async def main():
    cfg = load_config()
    init_db(cfg["db_path"])
    if cfg["image_dir"]:
        os.makedirs(cfg["image_dir"], exist_ok=True)
        log.info("Urun gorselleri su klasore indirilecek: %s", cfg["image_dir"])
    else:
        log.info("TG_IMAGE_DIR tanimli degil -- urun gorselleri indirilmeyecek.")

    client = TelegramClient(cfg["session_name"], cfg["api_id"], cfg["api_hash"])

    await client.start()
    log.info("Telegram'a baglanildi.")

    # Kanal adlarini gercek entity'lere cozumle (baglantiyi baslangicta dogrulamak icin).
    # (entity, kanal_adi) ciftlerini AYNI dongude, sadece basarili olanlar icin
    # bir arada tutuyoruz -- basarisiz bir kanal varsa sonradan ayri listeleri
    # zip'lemek entity/kanal-adi eslesmesini kaydirip yanlis kanala yazardi.
    resolved_pairs = []
    for ch in cfg["channels"]:
        try:
            entity = await client.get_entity(ch)
            resolved_pairs.append((entity, ch))
            log.info("Kanal bulundu: @%s (%s)", ch, getattr(entity, "title", ch))
        except Exception as e:  # noqa: BLE001
            log.warning("Kanal cozumlenemedi: @%s -- %s (yanlis kullanici adi olabilir)", ch, e)

    if not resolved_pairs:
        log.error("Dinlenecek gecerli hicbir kanal bulunamadi. TG_CHANNELS degerini kontrol edin.")
        sys.exit(1)

    resolved = [entity for entity, _ in resolved_pairs]

    def _extract_button_urls(message) -> list[str]:
        """Cogu firsat kanali 'Satin Al' / 'Urune Git' linkini mesaj metnine
        degil, fotografin altindaki tiklamali butona koyuyor. message.text
        bunu icermez, bu yuzden Telethon'un message.buttons alanindan ayrica
        okuyoruz."""
        urls: list[str] = []
        buttons = getattr(message, "buttons", None)
        if not buttons:
            return urls
        for row in buttons:
            for button in row:
                url = getattr(button, "url", None)
                if url:
                    urls.append(url)
        return urls

    def _extract_masked_link_urls(message) -> list[str]:
        """Bazi kanallar linki duz metin olarak degil, "gizli link" (goruntulenen
        metin farkli, asil url farkli -- Telegram'da metni secip link eklemek
        gibi) olarak ekliyor. message.text sadece GORUNEN metni verir, asil
        url'i vermez -- bu url'ler mesajin "entities" listesindeki
        MessageEntityTextUrl kayitlarinda saklanir (bu tur her zaman bir
        '.url' alanina sahiptir, diger entity tiplerinde bu alan yoktur)."""
        urls: list[str] = []
        entities = getattr(message, "entities", None) or []
        for ent in entities:
            url = getattr(ent, "url", None)
            if url:
                urls.append(url)
        return urls

    async def process_message(message, channel_name: str) -> bool:
        """Tek bir mesaji (canli event'ten veya catch-up taramasindan
        gelmis olabilir -- ikisi de ayni Telethon Message tipini kullanir)
        ayiklar, gerekirse gorselini indirir ve DB'ye yazar. Yeni bir satir
        eklendiyse True doner."""
        # Ayni mesaji daha once islediysek (ozellikle catch-up turlarinda
        # sik sik olur) burada erken cikip gereksiz parse/gorsel-indirme
        # islemi yapmiyoruz.
        if message_exists(cfg["db_path"], channel=channel_name, message_id=message.id):
            return False

        text = message.raw_text or ""
        offer = parse_message(text)

        extra_urls = _extract_button_urls(message) + _extract_masked_link_urls(message)
        if extra_urls:
            add_links(offer, extra_urls)

        # Gorseli sadece gercekten bir firsat adayiysa indiriyoruz --
        # sohbet/duyuru mesajlarinin fotograflarini indirmek bosuna disk
        # ve bant genisligi harcar. message.photo, mesajda bir fotograf
        # varsa doludur (video/dokuman gibi diger medya turlerini kasten
        # atliyoruz).
        image_filename = None
        if cfg["image_dir"] and offer.looks_like_offer and getattr(message, "photo", None):
            safe_channel = "".join(c if (c.isalnum() or c in "-_") else "_" for c in channel_name)
            candidate_filename = f"{safe_channel}_{message.id}.jpg"
            try:
                saved_path = await message.download_media(
                    file=os.path.join(cfg["image_dir"], candidate_filename)
                )
                if saved_path:
                    image_filename = os.path.basename(saved_path)
            except Exception as e:  # noqa: BLE001
                log.warning("Gorsel indirilemedi [@%s] #%s -- %s", channel_name, message.id, e)

        is_new = insert_message(
            cfg["db_path"],
            channel=channel_name,
            message_id=message.id,
            message_date=message.date,
            raw_text=text,
            product_guess=offer.product_guess,
            price_amount=offer.price_amount,
            price_currency=offer.price_currency,
            discount_percent=offer.discount_percent,
            shop_links=offer.shop_links,
            looks_like_offer=offer.looks_like_offer,
            image_filename=image_filename,
        )

        if not is_new:
            return False  # baska bir yerden (ayni anda calisan baska bir tur) az once eklendi

        if offer.looks_like_offer:
            log.info(
                "FIRSAT ADAYI [@%s] %s -- %s TL (%%%s indirim) -> %s",
                channel_name,
                offer.product_guess or "?",
                offer.price_amount,
                offer.discount_percent or "-",
                offer.shop_links[0] if offer.shop_links else "-",
            )
        else:
            log.debug("Mesaj kaydedildi ama firsat gibi gorunmuyor [@%s] #%s", channel_name, message.id)
        return True

    @client.on(events.NewMessage(chats=resolved))
    async def handler(event):
        chat = await event.get_chat()
        channel_name = getattr(chat, "username", None) or str(event.chat_id)
        await process_message(event.message, channel_name)

    async def catch_up_once():
        """Her kanalin son birkac mesajini Telegram'in kendi gecmisinden
        yeniden ceker. Internet kisa sureli kesilip live event'ler
        kacirilmis olsa bile, bu tur sayesinde hicbir mesaj kalici olarak
        atlanmaz -- zaten kaydedilmis mesajlar message_exists ile ucuzca
        atlanir, bu yuzden bu fonksiyon guvenle tekrar tekrar cagrilabilir.
        """
        for entity, channel_name in resolved_pairs:
            try:
                async for message in client.iter_messages(entity, limit=30):
                    await process_message(message, channel_name)
            except Exception as e:  # noqa: BLE001
                log.warning("Gecmis tarama basarisiz [@%s] -- %s", channel_name, e)

    async def periodic_catch_up(interval_seconds: int = 180):
        while True:
            await asyncio.sleep(interval_seconds)
            log.debug("Periyodik gecmis taramasi basliyor...")
            await catch_up_once()

    log.info("Baslangic taramasi yapiliyor (varsa kacirilan mesajlari yakalamak icin)...")
    await catch_up_once()

    # Ondan sonra hem canli dinleme hem de periyodik "kacirdim mi" taramasi
    # ayni anda calisir -- boylece kisa sureli internet kesintileri sonrasi
    # hicbir mesaj kalici olarak kaybolmaz.
    asyncio.create_task(periodic_catch_up())

    log.info("Dinleniyor: %s", ", ".join(cfg["channels"]))
    log.info("Cikmak icin Ctrl+C")
    await client.run_until_disconnected()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log.info("Durduruldu.")
