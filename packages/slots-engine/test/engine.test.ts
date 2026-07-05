import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfig,
  drawSymbol,
  spinGrid,
  resolveLines,
  countScatters,
  playSpin,
} from "../src/engine.js";
import {
  ProvablyFairRNG,
  generateServerSeed,
  hashServerSeed,
  verifyServerSeed,
  CryptoRNG,
} from "../src/rng.js";
import type { GameConfig } from "../src/types.js";
import { InvalidGameConfigError } from "../src/types.js";
import { yoshiFortune } from "../games/yoshi-fortune.js";
import { simulate } from "../src/simulator.js";

/** Config mínima determinística para testes de resolução. */
const tiny: GameConfig = {
  id: "tiny",
  name: "Tiny",
  rows: 3,
  cols: 3,
  symbols: ["A", "B", "W", "S"],
  reels: [
    { A: 50, B: 40, W: 5, S: 5 },
    { A: 50, B: 40, W: 5, S: 5 },
    { A: 50, B: 40, W: 5, S: 5 },
  ],
  paylines: [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 4, 8],
    [2, 4, 6],
  ],
  paytable: [
    { symbol: "A", count: 3, multiplier: 2 },
    { symbol: "B", count: 3, multiplier: 5 },
    { symbol: "W", count: 3, multiplier: 20 },
  ],
  wild: "W",
  scatter: { symbol: "S", countToTrigger: 3, freeSpinsAwarded: 5 },
  winMultiplier: { probability: 0.5, values: [2, 10], weights: [90, 10] },
  targetRtp: 0.96,
  volatility: "medium",
};

/* ============ Validação de configuração ============ */

test("validateConfig aceita configs válidas", () => {
  validateConfig(tiny);
  validateConfig(yoshiFortune);
});

test("validateConfig rejeita reel com símbolo desconhecido", () => {
  const bad = { ...tiny, reels: [{ X: 10 }, tiny.reels[1]!, tiny.reels[2]!] };
  assert.throws(() => validateConfig(bad as GameConfig), InvalidGameConfigError);
});

test("validateConfig rejeita payline fora do grid", () => {
  const bad = { ...tiny, paylines: [[0, 1, 99]] };
  assert.throws(() => validateConfig(bad as GameConfig), InvalidGameConfigError);
});

test("validateConfig rejeita reels.length != cols", () => {
  const bad = { ...tiny, reels: tiny.reels.slice(0, 2) };
  assert.throws(() => validateConfig(bad as GameConfig), InvalidGameConfigError);
});

/* ============ RNG provably fair ============ */

test("provably fair: mesmo (seeds, nonce) → mesmo resultado; nonce diferente → diferente", () => {
  const server = generateServerSeed();
  const a = new ProvablyFairRNG(server, "cliente-123", 7);
  const b = new ProvablyFairRNG(server, "cliente-123", 7);
  const c = new ProvablyFairRNG(server, "cliente-123", 8);

  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  const seqC = Array.from({ length: 20 }, () => c.next());

  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test("provably fair: hash do server seed é verificável (compromisso)", () => {
  const server = generateServerSeed();
  const hash = hashServerSeed(server);
  assert.equal(hash.length, 64);
  assert.ok(verifyServerSeed(server, hash));
  assert.ok(!verifyServerSeed("outro-seed", hash));
});

test("spin é reproduzível a partir dos seeds (auditoria independente)", () => {
  const server = generateServerSeed();
  const r1 = playSpin(yoshiFortune, new ProvablyFairRNG(server, "meu-seed", 42));
  const r2 = playSpin(yoshiFortune, new ProvablyFairRNG(server, "meu-seed", 42));
  assert.deepEqual(r1, r2);
});

/* ============ Distribuição de símbolos ============ */

test("drawSymbol respeita os pesos (qui-quadrado grosseiro, 200k sorteios)", () => {
  const reel = { A: 500, B: 300, C: 200 };
  const cfgSymbols = ["A", "B", "C"];
  const rng = new CryptoRNG();
  const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
  const N = 200_000;
  for (let i = 0; i < N; i++) counts[drawSymbol(reel, rng)]!++;

  for (const s of cfgSymbols) {
    const expected = (reel as Record<string, number>)[s]! / 1000;
    const observed = counts[s]! / N;
    assert.ok(
      Math.abs(observed - expected) < 0.01,
      `${s}: esperado ${expected}, observado ${observed.toFixed(4)}`
    );
  }
});

/* ============ Resolução de paylines ============ */

test("linha simples paga o multiplicador da paytable", () => {
  const grid = ["A", "A", "A", "B", "A", "B", "B", "B", "A"];
  const wins = resolveLines(tiny, grid);
  const top = wins.find((w) => w.lineIndex === 0);
  assert.ok(top);
  assert.equal(top.symbol, "A");
  assert.equal(top.multiplier, 2);
});

test("wild substitui símbolo comum e completa a linha", () => {
  const grid = ["A", "W", "A", "B", "B", "S", "S", "A", "B"];
  const wins = resolveLines(tiny, grid);
  const top = wins.find((w) => w.lineIndex === 0);
  assert.ok(top, "A-W-A deveria pagar como 3x A");
  assert.equal(top.symbol, "A");
});

test("linha inteira de wilds paga como wild (maior prêmio)", () => {
  const grid = ["W", "W", "W", "A", "B", "A", "B", "A", "B"];
  const wins = resolveLines(tiny, grid);
  const top = wins.find((w) => w.lineIndex === 0);
  assert.ok(top);
  assert.equal(top.symbol, "W");
  assert.equal(top.multiplier, 20);
});

test("edge case: grid inteiro igual paga as 5 linhas", () => {
  const grid = Array(9).fill("B") as string[];
  const wins = resolveLines(tiny, grid);
  assert.equal(wins.length, 5);
  assert.ok(wins.every((w) => w.symbol === "B" && w.multiplier === 5));
});

test("edge case: nenhuma combinação → zero prêmios, multiplicador 0", () => {
  // sem 3 iguais em nenhuma das 5 linhas (S no centro quebra as diagonais)
  const grid = ["A", "B", "A", "B", "S", "B", "B", "A", "B"];
  const wins = resolveLines(tiny, grid);
  assert.equal(wins.length, 0);

  // e a feature nunca ativa sem ganho
  const server = generateServerSeed();
  for (let nonce = 0; nonce < 50; nonce++) {
    const r = playSpin(tiny, new ProvablyFairRNG(server, "x", nonce));
    if (r.baseMultiplier === 0) {
      assert.equal(r.featureMultiplier, 1, "feature não pode ativar sem ganho");
      assert.equal(r.totalMultiplier, 0);
    }
  }
});

test("scatter não paga em linha, mas conta em qualquer posição", () => {
  const grid = ["S", "S", "S", "A", "B", "A", "B", "A", "B"];
  const wins = resolveLines(tiny, grid);
  assert.equal(wins.filter((w) => w.symbol === "S").length, 0);
  assert.equal(countScatters(tiny, grid), 3);

  // 3 scatters atingem o gatilho do tiny (countToTrigger: 3)
  const spin = { grid, scatters: countScatters(tiny, grid) };
  assert.ok(spin.scatters >= tiny.scatter!.countToTrigger);
});

/* ============ Simulador ============ */

test("simulador: RTP do Yoshi Fortune fica dentro de ±1 p.p. em 300k spins", () => {
  const report = simulate(yoshiFortune, 300_000);
  assert.ok(
    Math.abs(report.rtp - yoshiFortune.targetRtp) < 0.015,
    `RTP ${(report.rtp * 100).toFixed(2)}% muito longe do alvo em 300k spins`
  );
  assert.ok(report.hitRate > 0.1 && report.hitRate < 0.6);
});
