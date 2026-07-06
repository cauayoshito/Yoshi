/**
 * Yoshi Fortune — jogo-vitrine da engine (estilo Fortune Tiger).
 * Grid 3x3, 5 paylines, wild, multiplicador aleatório e free spins.
 *
 * IMPORTANTE: este arquivo é SÓ configuração. A matemática vive na engine.
 * Multiplicadores da paytable aplicam sobre a APOSTA TOTAL da rodada.
 * RTP validado por simulação (scripts/simulate.ts) — não editar a paytable
 * sem rodar o simulador de novo.
 */
import type { GameConfig } from "../src/types.js";

export const yoshiFortune: GameConfig = {
  id: "yoshi-fortune",
  name: "Yoshi Fortune",
  rows: 3,
  cols: 3,
  symbols: ["yoshi", "ingot", "envelope", "firecracker", "orange", "bell", "scroll"],

  // Pesos por reel — o reel central é levemente mais rico em wild,
  // padrão do gênero para criar "quase-ganhos" visíveis.
  reels: [
    { bell: 255, orange: 225, firecracker: 180, envelope: 130, ingot: 85, yoshi: 45, scroll: 80 },
    { bell: 245, orange: 220, firecracker: 175, envelope: 130, ingot: 85, yoshi: 65, scroll: 80 },
    { bell: 255, orange: 225, firecracker: 180, envelope: 130, ingot: 85, yoshi: 45, scroll: 80 },
  ],

  // 3 linhas horizontais + 2 diagonais (índices row-major no grid 3x3)
  paylines: [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 4, 8],
    [2, 4, 6],
  ],

  paytable: [
    { symbol: "yoshi", count: 3, multiplier: 25 },
    { symbol: "ingot", count: 3, multiplier: 10 },
    { symbol: "envelope", count: 3, multiplier: 5 },
    { symbol: "firecracker", count: 3, multiplier: 2.5 },
    { symbol: "orange", count: 3, multiplier: 1.5 },
    { symbol: "bell", count: 3, multiplier: 1 },
  ],

  wild: "yoshi",

  scatter: {
    symbol: "scroll",
    countToTrigger: 4,
    freeSpinsAwarded: 6,
  },

  winMultiplier: {
    probability: 0.145,
    values: [2, 3, 5, 10],
    weights: [55, 27, 13, 5],
  },

  targetRtp: 0.965,
  volatility: "medium",

  display: {
    symbols: { yoshi: "🐲", ingot: "💰", envelope: "🧧", firecracker: "🧨", orange: "🍊", bell: "🔔", scroll: "📜" },
    labels: { yoshi: "Yoshi (wild)", ingot: "Ouro", envelope: "Envelope", firecracker: "Fogos", orange: "Laranja", bell: "Sino", scroll: "Pergaminho (scatter)" },
    gradient: "linear-gradient(165deg,#2a0d0f 0%,#3d1114 45%,#24090b 100%)",
    accent: "#ffb800",
  },
};
