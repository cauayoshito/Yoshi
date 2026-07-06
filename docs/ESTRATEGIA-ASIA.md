# 🌏 YOSHI BET / Slots Engine — Estratégia B2B para mercados licenciados (Ásia)

> Análise de mercado e roadmap para posicionar a stack como produto vendável a
> operadores licenciados, com foco inicial nas Filipinas (PAGCOR).
> Pesquisa: julho/2026.

## 1. O que estamos vendendo

Não competimos com a Bet365 pelo jogador — competimos com **SoftSwiss/EveryMatrix
pelo operador**. O produto é a stack B2B:

- **Engine de slots reusável** (`packages/slots-engine`): GameConfig declarativo,
  RNG provably fair auditável, simulador de RTP reproduzível — um jogo novo é um
  arquivo de config, não código novo
- **Plataforma de referência** (YOSHI BET): carteira transacional em livro-razão,
  PIX, sportsbook demo, PWA
- **Backoffice de compliance**: RTP real vs configurado, config versionada com
  trilha de quem alterou, log de auditoria de rodadas, snapshots de RTP

## 2. Cenário regulatório — por que Filipinas primeiro

A Ásia licenciada, na prática, é **Filipinas (PAGCOR)**: Japão, Coreia, China e
Singapura não licenciam iGaming online privado; Macau é presencial.

**Janela regulatória AGORA (crítico):** a PAGCOR passou a exigir credenciamento
de **todos** os fornecedores B2B (plataforma, conteúdo, RNG, live studio,
pagamento, KYC) como **Authorised Service Provider (ASP)**:

- Prazo geral de credenciamento: **31/jul/2026** (descomissionamento a partir
  de 1º/ago/2026); streaming/conteúdo estrangeiro: 31/mar/2026
- Requisitos-chave: entidade filipina registrada na SEC, capitalização
  comprovada, **certificação técnica por laboratório reconhecido pela PAGCOR**,
  programa de segurança da informação mapeado a **ISO/IEC 27001**, evidência de
  matemática do jogo e RNG
- Efeito colateral positivo: o prazo vai **expulsar fornecedores informais** —
  quem chegar credenciado encontra menos concorrência

**Custo de certificação de jogo (lab)**: GLI-19/iTech Labs ≈ **US$ 15–35k por
título**, 6–12 semanas (85% passam de primeira). Nossa arquitetura foi desenhada
para isso: RNG determinístico verificável + simulador de RTP reproduzível
reduzem o risco de reprovação.

## 3. Concorrentes e preços de referência

| Concorrente | Perfil | Setup típico | Nosso ângulo |
|---|---|---|---|
| **SoftSwiss** | White-label cripto-nativo, 30k+ jogos | €30–80k + rev-share | Somos mais leves e transparentes (provably fair de ponta a ponta) |
| **EveryMatrix** | Modular enterprise, 25k+ jogos, multi-jurisdição | €50–150k + rev-share | Custo total deles a US$3M GGR: +€50–200k/ano — atacamos operador pequeno/médio |
| **GiG** | Plataforma + sportsbook + mídia | enterprise | Não competimos em sportsbook profundo |
| **BetConstruct / Slotegrator** | Turnkey/agregadores | variado | Agregador é parceiro potencial, não rival |
| **BGaming / Hacksaw** | Estúdios de jogos (provably fair) | por título | Referência de qualidade para nossos Originals |

**Posicionamento:** *"engine provably fair auditável + plataforma completa, na
faixa de preço que a SoftSwiss não desce"* — operadores PIGO pequenos/médios e
novos entrantes que precisam demonstrar compliance à PAGCOR sem pagar setup de
€100k+.

## 4. Gaps vs os grandes (o que falta para vender)

| Gap | Exigido por | Status hoje |
|---|---|---|
| **Multi-tenant / white-label** (N operadores, 1 stack, temas por marca) | modelo de negócio B2B | ❌ single-tenant |
| **i18n + multi-moeda** (EN, 中文, ₱/USD/USDT) | operador asiático | ❌ pt-BR/R$ fixos |
| **Jogo responsável**: limites de depósito/perda, autoexclusão, realidade-check | PAGCOR (obrigatório) | ❌ só links no rodapé |
| **KYC/AML hooks** (verificação de idade/identidade, relatório de transações) | PAGCOR/AML | ❌ |
| **Relatórios regulatórios exportáveis** (GGR, rodadas, RTP por período, CSV) | PAGCOR/auditoria | ⚠️ dados existem; falta exportação |
| **Papéis no backoffice** (admin/operador/auditor read-only) | due diligence | ⚠️ só admin |
| **Observabilidade/SLA** (healthchecks, métricas, alertas, uptime público) | contrato B2B | ⚠️ básico |
| **Migrações versionadas + backups testados** | operação séria | ⚠️ schema idempotente no boot |
| **Certificação GLI-19/iTech de 1 título** | credibilidade de venda | ❌ (processo pago, ~US$20k) |
| **Pitch em inglês + demo pública estável** | vendas | ⚠️ |

## 5. Roadmap priorizado

**P0 — habilitadores de venda (fazer já):**
1. Multi-tenant básico: tabela `tenants`, tema/marca por tenant, jogos e limites
   por tenant — transforma o repo de "um cassino" em "uma plataforma"
2. i18n (pt/en) com dicionário central + formatação de moeda plugável
3. Jogo responsável: limites de depósito/perda por período, autoexclusão com
   bloqueio real de login/aposta, realidade-check no jogo (PAGCOR exige — e é
   diferencial de demo)
4. Exportação de relatórios (CSV) no backoffice: GGR, rodadas, RTP por período

**P1 — profundidade de produto:**
5. Papéis no backoffice (operador/auditor read-only) + trilha de acesso
6. Segundo jogo na engine (ex.: 5x3, 20 linhas, cascata) provando "config, não
   código" — argumento central do pitch
7. Observabilidade: métricas de latência/erro por rota, página de status
8. Migrações versionadas (node-pg-migrate) + rotina de backup/restore

**P2 — go-to-market:**
9. Landing B2B em inglês (pitch da engine, relatório de RTP, provably fair)
10. Dossiê técnico para lab (arquitetura, fluxos, evidências do simulador) —
    encurta as 2–3 semanas de revisão documental da certificação
11. Parceria com agregador (Slotegrator-like) como canal de distribuição

**Performance (transversal, medir antes/depois com Lighthouse):**
- TTFB da função serverless (keep-warm via cron diário já ajuda), `preconnect`
  a fonts, lazy-load de imagens de card fora da viewport, code-split do admin,
  comprimir twemoji SVGs, relatório Lighthouse ≥ 90 em Performance/PWA

## 6. Fontes

- PAGCOR ASP/B2B: legalbison.com, respicio.ph, zigram.tech, yogonet.com,
  chambers.com (out/2025–jan/2026)
- Mercado B2B: jadexconsulting.com, bestwhitelabelcasinos.com, igaminghub.app,
  affpapa.com
- Certificação: gaminglabs.com, itechlabs.com, sdlccorp.com, gamixlabs.com

> ⚠️ Nada aqui é aconselhamento jurídico. O credenciamento PAGCOR exige
> assessoria local (entidade SEC filipina, mayor's permit, BIR).
