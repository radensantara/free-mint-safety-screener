# Free-Mint Safety Screener — Dockerfile
# Deploy target #1: Northflank Sandbox (Combined service, Build: Dockerfile).
# Juga jalan di Render (native Node) — lihat render.yaml.
# Server listen di $PORT yang di-inject platform; EXPOSE hanya dokumentasi.
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
# Tidak ada dependensi (stdlib saja), tapi langkah ini menjaga build tetap
# benar kalau dependensi ditambahkan nanti.
RUN npm install --omit=dev --no-audit --no-fund || true

COPY server.js ./

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
