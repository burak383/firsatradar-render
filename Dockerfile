# FirsatRadar -- Render.com icin tek-container deploy.
#
# Bu image icinde HEM backend (Node/Express) HEM DE Telegram listener
# (Python/Telethon) calisir -- render_start.js ikisini de ayni servis
# icinde yonetir (bkz. o dosyadaki aciklama). Tek servis + tek kalici
# disk kullanarak maliyeti dusuk tutmak icin boyle tasarlandi.

FROM node:20-slim

# Python3 + venv + pip (Telegram listener icin) + derleme araclari
# (better-sqlite3 gibi native Node modulleri icin onceden derlenmis bir
# binary bulunamazsa kaynaktan derlemesi gerekebilir).
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 \
        python3-venv \
        python3-pip \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Backend (Node) bagimliliklari -------------------------------------
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev

# --- Telegram listener (Python) bagimliliklari --------------------------
# Sistem paketleriyle karismasin diye ayri bir venv kullaniyoruz.
COPY telegram_listener/requirements.txt ./telegram_listener/requirements.txt
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r telegram_listener/requirements.txt
ENV PATH="/opt/venv/bin:${PATH}"

# --- Uygulama kodu -------------------------------------------------------
COPY backend ./backend
COPY telegram_listener ./telegram_listener
COPY render_start.js ./render_start.js

# Render, Web Service'lerde bu klasore kalici bir disk baglar (bkz. Render
# dashboard'da "Add Disk", mount path: /data). Image icinde de olusturuyoruz
# ki disk henuz baglanmadan calistirilirsa hata vermesin.
RUN mkdir -p /data

EXPOSE 4000

CMD ["node", "render_start.js"]
