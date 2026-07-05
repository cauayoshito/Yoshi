# YOSHI BET — imagem de produção
FROM node:22-slim

WORKDIR /app

# Dependências do servidor (camada cacheável). Toolchain instalado só para o
# caso do better-sqlite3 precisar compilar (sem prebuild), e removido depois.
COPY server/package.json server/package-lock.json server/
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && npm ci --omit=dev --prefix server \
 && apt-get purge -y --auto-remove python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Copia o restante (front-end estático + código do servidor)
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/yoshibet.db

# Persistência: monte um volume da plataforma em /data (Railway/Render).
# Não usamos a instrução VOLUME aqui — o Railway não a suporta e o deploy falha.
EXPOSE 3000

CMD ["node", "server/src/index.js"]
