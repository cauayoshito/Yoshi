# 🚀 Deploy do YOSHI BET

O banco é **Postgres (Supabase)** — o schema é criado automaticamente no
primeiro boot (migração idempotente). O app roda na **Vercel** (serverless),
em **Railway/Render** ou em qualquer máquina com Node/Docker.

## Variáveis de ambiente

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | **Sim** | Connection string do Supabase (pooler, porta 6543 — veja abaixo) |
| `JWT_SECRET` | **Sim** | Segredo dos tokens. Gere um: `openssl rand -hex 32` |
| `ADMIN_EMAIL` | Recomendada | E-mail que ganha acesso ao painel `/admin.html` ao se cadastrar |
| `CRON_SECRET` | Vercel | Protege `/api/cron/settle` (liquidação via Vercel Cron) |
| `PIX_DEMO_AUTOCONFIRM_MS` | Não | Demo: ms até confirmar o PIX sozinho (padrão 4000; 0 desliga) |
| `PORT` | Não | Porta HTTP (só em servidor persistente) |

### Onde pegar a `DATABASE_URL` no Supabase

Dashboard do projeto → botão **Connect** → aba **Transaction pooler** → copie a
**URI** (host `...pooler.supabase.com`, porta **6543**) e troque `[YOUR-PASSWORD]`
pela senha do banco definida na criação do projeto
(esqueceu? **Settings → Database → Reset database password**).

> Use o **pooler (6543)**, não a conexão direta (5432) — serverless abre muitas
> conexões curtas e o pooler existe exatamente para isso.

## Opção 1 — Vercel + Supabase (recomendado)

1. [vercel.com](https://vercel.com) → **Add New → Project** → importe o repo
   `cauayoshito/Yoshi` do GitHub (framework: **Other**, sem mudar nada de build)
2. Em **Environment Variables**, adicione: `DATABASE_URL`, `JWT_SECRET`,
   `ADMIN_EMAIL` e `CRON_SECRET`
3. **Deploy** → a URL pública sai na hora; o schema do banco se cria sozinho
   na primeira requisição
4. A liquidação das apostas roda via **Vercel Cron** (`vercel.json`, a cada
   10 min) chamando `/api/cron/settle` com o `CRON_SECRET`

Como funciona: o front estático é servido pela CDN da Vercel; toda rota
`/api/*` cai na função serverless `api/index.js` (o Express inteiro roda lá).

## Opção 2 — Railway / Render / VPS (servidor persistente)

Mesmo código, mesmo banco Supabase — sem volume, sem SQLite:

- **Railway**: New Project → Deploy from GitHub → adicione `DATABASE_URL`,
  `JWT_SECRET`, `ADMIN_EMAIL` em Variables → Generate Domain
- **Render**: New → Blueprint (o `render.yaml` já configura; preencha
  `DATABASE_URL` quando pedir)
- **Docker**:

```bash
docker build -t yoshibet .
docker run -d -p 80:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -e ADMIN_EMAIL="seu@email.com" \
  --restart unless-stopped yoshibet
```

- **Node puro**: `cd server && npm ci --omit=dev && DATABASE_URL=... npm start`

## Depois do deploy

1. Abra a URL pública → a plataforma carrega
2. Cadastre-se com o `ADMIN_EMAIL` → essa conta vira administradora
3. Acesse `https://sua-url/admin.html` → dashboard com métricas e liquidação
4. Dados demo no dashboard (opcional): rode localmente
   `DATABASE_URL="postgresql://..." npm run seed --prefix server`
   apontando para o mesmo banco

> ⚠️ Lembrete: é um projeto demonstrativo. Operar com dinheiro real exige PSP
> autorizado pelo BACEN, KYC e licença SPA/Ministério da Fazenda.
