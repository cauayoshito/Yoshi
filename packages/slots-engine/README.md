# @yoshibet/slots-engine

Engine de slots **reusável e auditável** — nenhum jogo é hardcoded: um jogo
novo é um `GameConfig` novo (grid, pesos por reel, paytable, features, RTP
alvo). Zero dependências de UI e zero dependências de runtime.

## Módulos

| Módulo | Responsabilidade |
|---|---|
| `src/types.ts` | `GameConfig` declarativo, `SpinResult`, validação de tipos |
| `src/rng.ts` | RNG **provably fair** (server seed + client seed + nonce, HMAC-SHA256) e CSPRNG para simulação. Nunca `Math.random()` |
| `src/engine.ts` | Funções puras: sorteio ponderado, `spinGrid`, `resolveLines` (wild, scatter), `playSpin` |
| `src/simulator.ts` | Simulador de RTP: N spins, hit rate, feature/free-spin trigger, desvio padrão |
| `games/yoshi-fortune.ts` | **Yoshi Fortune** — jogo-vitrine 3x3 estilo Fortune (wild, multiplicador aleatório 2–10x, free spins) |

## Provably fair

1. Servidor gera `serverSeed` e publica `sha256(serverSeed)` **antes** da rodada
2. Resultado = `HMAC-SHA256(serverSeed, clientSeed:nonce:bloco)` → stream uniforme
3. Após a rodada o `serverSeed` é revelado; qualquer pessoa reproduz o
   resultado com `new ProvablyFairRNG(serverSeed, clientSeed, nonce)` e
   confere o compromisso com `verifyServerSeed`

## Comandos

```bash
npm install
npm test            # 15 testes: distribuição, resolução, edge cases, fairness
npm run simulate    # RTP em 2M spins (padrão)
npm run simulate -- 10000000
```

## Resultado de referência (Yoshi Fortune, 10M spins)

```
RTP medido:   96.510%  (alvo 96.5%, desvio 0.010 p.p.)
Hit rate:     28.54%
Maior prêmio: 410x
Volatilidade: média (σ 3.11)
```

> Arquitetura desenhada para auditoria (RNG determinístico verificável,
> simulador reproduzível). Certificação formal de RNG (iTech Labs, GLI) é
> processo separado, conduzido pelo operador licenciado.
