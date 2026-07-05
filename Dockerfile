# YOSHI BET — imagem de produção (Railway/Render/VPS)
# O banco é Postgres (Supabase): configure DATABASE_URL no ambiente.
FROM node:22-slim

WORKDIR /app

# Dependências do servidor (camada cacheável) — 100% JavaScript, sem compilação
COPY server/package.json server/package-lock.json server/
RUN npm ci --omit=dev --prefix server

# Copia o restante (front-end estático + código do servidor)
COPY . .

ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

CMD ["node", "server/src/index.js"]
