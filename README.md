# 🐲 YOSHI BET — Plataforma iGaming (Full-Stack)

Plataforma de cassino online no estilo das grandes casas brasileiras (tema escuro,
verde neon + dourado, PIX, bônus de boas-vindas), com **front-end** em HTML/CSS/JS puros (ícones [Twemoji](https://github.com/jdecked/twemoji) CC-BY 4.0) e **backend** Node.js + Express + SQLite com autenticação JWT, carteira
transacional e jogos rodando no servidor.

> ⚠️ **Projeto demonstrativo.** Nenhuma aposta com dinheiro real é realizada.
> O PIX é simulado (payload EMV real, pagamento auto-confirmado).

## 🚀 Como rodar

```bash
cd server
npm install
npm start
# abra http://localhost:3000
```

Testes do backend (19 casos, sem dependência extra — `node:test`):

```bash
cd server && npm test
```

## 🏗️ Arquitetura

```
├── index.html            # SPA: views, modais, jogos
├── css/style.css         # Tema escuro completo + responsivo
├── js/
│   ├── data.js           # Constantes de UI
│   └── app.js            # Cliente da API + animações
└── server/
    ├── src/
    │   ├── index.js      # Bootstrap HTTP
    │   ├── app.js        # Express: rotas, rate-limit, estáticos
    │   ├── config.js     # Config via .env (veja .env.example)
    │   ├── db.js         # SQLite (better-sqlite3) + schema
    │   ├── middleware/   # JWT (auth.js) e erros (error.js)
    │   ├── routes/       # auth, wallet, games
    │   ├── services/     # wallet, pix, slot, mines
    │   └── data/games.json  # Catálogo servido em /api/games
    └── test/api.test.js  # Suíte de integração da API
```

### Decisões de projeto

- **Dinheiro em centavos (INTEGER)** — nada de float para valores monetários.
- **Livro-razão (`transactions`)** — todo crédito/débito vira lançamento; o saldo
  é atualizado na mesma transação SQLite com `CHECK (balance_cents >= 0)`,
  impossibilitando saldo negativo mesmo com requisições concorrentes.
- **RNG no servidor** — o resultado do slot e as bombas do Mines nunca existem
  no cliente. `crypto.randomInt` (CSPRNG do Node).
- **Provably fair** — cada rodada tem `server_seed`; o SHA-256 dele é entregue
  ao jogador no início e o seed é revelado no fim.
- **PIX real no formato** — o payload copia-e-cola segue o padrão EMV do BACEN,
  gerado com a lib open-source [`pix-utils`](https://github.com/thalesog/pix-utils),
  e o QR Code é real e escaneável (lib `qrcode`). A confirmação é simulada
  (em produção viria do webhook do PSP).
- **Apostas esportivas server-side** — Copa 2026 com odds e status calculados
  no servidor; odds enviadas pelo cliente são ignoradas na hora de apostar.
- **Hardening** — `helmet`, `compression`, `morgan` (logs), rate-limit por IP,
  body JSON limitado a 64kb.
- **Bônus de 1º depósito** — 100% até R$ 500, idempotente (webhook duplicado
  não credita duas vezes).

## 📡 API

Autenticação: `Authorization: Bearer <token>` (JWT, 7 dias).

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | Status do serviço |
| POST | `/api/auth/register` | Cria conta `{name,email,password}` → token |
| POST | `/api/auth/login` | Login `{email,password}` → token |
| GET | `/api/auth/me` | Usuário logado + saldo |
| GET | `/api/wallet` | Saldo + extrato (últimos 30 lançamentos) |
| POST | `/api/wallet/deposit` | Cria cobrança PIX `{amountCents}` → txid + BR Code |
| GET | `/api/wallet/deposit/:txid` | Status da cobrança (front faz polling) |
| POST | `/api/wallet/deposit/:txid/webhook` | Confirmação do PSP (demo) |
| POST | `/api/wallet/withdraw` | Saque `{amountCents,pixKey}` |
| GET | `/api/games` | Catálogo de jogos |
| POST | `/api/games/slot/spin` | Gira o Fortune Yoshi `{betCents}` |
| GET | `/api/games/mines/active` | Rodada ativa do Mines (retomada) |
| POST | `/api/games/mines/start` | Inicia Mines `{betCents}` |
| POST | `/api/games/mines/reveal` | Revela célula `{cell}` |
| POST | `/api/games/mines/cashout` | Retira o ganho acumulado |
| GET | `/api/games/history` | Últimas 30 rodadas liquidadas |
| GET | `/api/sports/matches` | Copa 2026: partidas, odds e status (upcoming/live/finished) |
| POST | `/api/sports/bet` | Aposta esportiva `{matchId,pick,stakeCents}` — odds do servidor |
| GET | `/api/sports/bets` | Minhas apostas esportivas |

Limites (config via `.env`): depósito R$ 20–10.000 · aposta R$ 0,50–50 · saque mín. R$ 20.

## 🔜 Próximos passos (para produção de verdade)

- Postgres no lugar do SQLite + migrações versionadas
- Gateway PIX real (PSP autorizado pelo BACEN) com webhook assinado
- Integração com agregadores de jogos licenciados (a estrutura de rounds já suporta)
- KYC/verificação de idade, limites de jogo responsável e autoexclusão
- Licenciamento SPA/Ministério da Fazenda (apostas de quota fixa)
