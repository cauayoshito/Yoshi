# YOSHI BET — imagem de produção
FROM node:22-slim

WORKDIR /app

# Instala apenas as dependências do servidor (camada cacheável)
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev

# Copia o restante (front-end estático + código do servidor)
COPY . .

ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/yoshibet.db

# Monte um volume em /data para o SQLite sobreviver a deploys
VOLUME /data
EXPOSE 3000

CMD ["node", "server/src/index.js"]
