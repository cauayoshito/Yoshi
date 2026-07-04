# 🚀 Deploy do YOSHI BET

O projeto roda em qualquer lugar que aceite Node.js ou Docker. O SQLite fica em
`DB_PATH` — em produção monte um volume persistente para não perder os dados.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `JWT_SECRET` | **Sim** | Segredo dos tokens. Gere um: `openssl rand -hex 32` |
| `ADMIN_EMAIL` | Recomendada | E-mail que ganha acesso ao painel `/admin.html` ao se cadastrar |
| `PORT` | Não | Porta HTTP (padrão 3000; plataformas geralmente injetam) |
| `DB_PATH` | Não | Caminho do SQLite (padrão `server/data/yoshibet.db`; no Docker use `/data/yoshibet.db`) |
| `PIX_DEMO_AUTOCONFIRM_MS` | Não | Demo: ms até confirmar o PIX sozinho (0 desliga) |

## Opção 1 — Railway (mais fácil, tem volume no plano free)

1. [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo**
2. Railway detecta o `Dockerfile` sozinho
3. Em **Variables**, defina `JWT_SECRET` e `ADMIN_EMAIL`
4. Em **Settings → Volumes**, monte um volume em `/data`
5. **Settings → Networking → Generate Domain** → pronto, URL pública

## Opção 2 — Render (blueprint pronto)

1. Suba o repo no GitHub
2. [render.com](https://render.com) → **New → Blueprint** → selecione o repo
3. O `render.yaml` já configura serviço, disco persistente e `JWT_SECRET`

## Opção 3 — VPS / máquina própria (Docker)

```bash
docker build -t yoshibet .
docker run -d --name yoshibet \
  -p 80:3000 \
  -v yoshibet-data:/data \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_EMAIL="seu@email.com" \
  --restart unless-stopped \
  yoshibet
```

## Opção 4 — Node puro (sem Docker)

```bash
cd server
npm ci --omit=dev
JWT_SECRET="$(openssl rand -hex 32)" ADMIN_EMAIL="seu@email.com" npm start
```

## Depois do deploy

1. Abra a URL pública → a plataforma carrega
2. Cadastre-se com o `ADMIN_EMAIL` → essa conta vira administradora
3. Acesse `https://sua-url/admin.html` → painel com métricas, usuários e liquidação
4. A liquidação automática roda a cada 60s no servidor (partidas encerradas
   ganham placar demo e as apostas são pagas). Para resultados reais, registre
   o placar manualmente no painel ou integre um feed esportivo.

> ⚠️ Lembrete: é um projeto demonstrativo. Operar com dinheiro real exige PSP
> autorizado pelo BACEN, KYC e licença SPA/Ministério da Fazenda.
