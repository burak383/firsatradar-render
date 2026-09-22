"""
db.py
-----
Cok basit bir SQLite katmani. Yakalanan her mesaji ve parser'in cikardigi
tahmini urun/fiyat bilgisini saklar. Ileride bunu Postgres/MySQL'e tasimak
istersen sadece bu dosyayi degistirmen yeterli -- listener.py'a dokunmana
gerek kalmaz.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS raw_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel TEXT NOT NULL,
    message_id INTEGER NOT NULL,
    message_date TEXT,
    raw_text TEXT,
    product_guess TEXT,
    price_amount REAL,
    price_currency TEXT,
    discount_percent INTEGER,
    shop_links TEXT,        -- virgulle ayrilmis liste
    looks_like_offer INTEGER NOT NULL DEFAULT 0,
    fetched_at TEXT NOT NULL,
    UNIQUE(channel, message_id)
);

CREATE INDEX IF NOT EXISTS idx_raw_messages_offer
    ON raw_messages (looks_like_offer, fetched_at);
"""

# image_filename: SCHEMA yukarida "CREATE TABLE IF NOT EXISTS" oldugu icin
# zaten var olan (eski) bir veritabaninda otomatik eklenmez -- bu yuzden
# asagida ayrica bir ALTER TABLE migration'i yapiyoruz.
MIGRATIONS = [
    ("image_filename", "ALTER TABLE raw_messages ADD COLUMN image_filename TEXT"),
]


def init_db(db_path: str) -> None:
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.executescript(SCHEMA)
        existing_cols = {row[1] for row in conn.execute("PRAGMA table_info(raw_messages)")}
        for col_name, alter_sql in MIGRATIONS:
            if col_name not in existing_cols:
                conn.execute(alter_sql)
        conn.commit()


@contextmanager
def get_conn(db_path: str):
    conn = sqlite3.connect(db_path)
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def message_exists(db_path: str, *, channel: str, message_id: int) -> bool:
    """Internet kesintisinden sonra gecmisi yeniden tararken (bkz. listener.py
    catch_up_once) ayni mesaji tekrar tekrar islememek (ozellikle gorseli
    tekrar tekrar INDIRMEMEK) icin ucuz bir on-kontrol. insert_message zaten
    INSERT OR IGNORE ile guvenli ama bu kontrol o noktaya gelmeden once
    (gorsel indirmeden once) erken cikmamizi saglar."""
    with get_conn(db_path) as conn:
        row = conn.execute(
            "SELECT 1 FROM raw_messages WHERE channel = ? AND message_id = ? LIMIT 1",
            (channel, message_id),
        ).fetchone()
        return row is not None


def insert_message(db_path: str, *, channel: str, message_id: int, message_date,
                    raw_text: str, product_guess, price_amount, price_currency,
                    discount_percent, shop_links: list[str], looks_like_offer: bool,
                    image_filename: str | None = None) -> bool:
    """Ayni (channel, message_id) tekrar gelirse sessizce atlar (INSERT OR IGNORE).
    Yeni bir satir eklendiyse True doner."""
    with get_conn(db_path) as conn:
        cur = conn.execute(
            """
            INSERT OR IGNORE INTO raw_messages
                (channel, message_id, message_date, raw_text, product_guess,
                 price_amount, price_currency, discount_percent, shop_links,
                 looks_like_offer, fetched_at, image_filename)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                channel,
                message_id,
                message_date.isoformat() if message_date else None,
                raw_text,
                product_guess,
                price_amount,
                price_currency,
                discount_percent,
                ",".join(shop_links) if shop_links else None,
                1 if looks_like_offer else 0,
                datetime.now(timezone.utc).isoformat(),
                image_filename,
            ),
        )
        return cur.rowcount > 0
