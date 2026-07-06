/**
 * Dragon's Hoard — slot 5x3 "scatter pays + tumble" (gênero Gates of
 * Olympus), com tema e matemática PRÓPRIOS. Paga por quantidade do símbolo
 * em qualquer posição; vencedores somem e novos caem (cascade); ao final,
 * um multiplicador aleatório pode dobrar o total.
 *
 * RTP calibrado por simulação Monte Carlo (scripts/simulate-all.ts).
 */
import type { GameConfig, ReelWeights, ScatterPayTier, SymbolId } from "../src/types.js";

const S = {
  crown: "crown", ring: "ring", chalice: "chalice", hourglass: "hourglass",
  red: "gem_red", blue: "gem_blue", green: "gem_green", purple: "gem_purple",
  orb: "orb",
};

const reel: ReelWeights = {
  [S.crown]: 45, [S.ring]: 55, [S.chalice]: 62, [S.hourglass]: 68,
  [S.red]: 72, [S.blue]: 76, [S.green]: 80, [S.purple]: 84,
  [S.orb]: 26,
};

/** 3 faixas por símbolo (8+, 10+, 12+), escaladas p/ o RTP alvo. */
const K = 0.519; // fator global de calibração do RTP
function tiers(symbol: SymbolId, base: number): ScatterPayTier[] {
  return [
    { symbol, minCount: 8, multiplier: +(base * K).toFixed(3) },
    { symbol, minCount: 10, multiplier: +(base * 2.2 * K).toFixed(3) },
    { symbol, minCount: 12, multiplier: +(base * 5 * K).toFixed(3) },
  ];
}

export const dragonsHoard: GameConfig = {
  id: "dragons-hoard",
  name: "Dragon's Hoard",
  kind: "scatter-tumble",
  rows: 5,
  cols: 6,
  symbols: [S.crown, S.ring, S.chalice, S.hourglass, S.red, S.blue, S.green, S.purple, S.orb],
  reels: [reel, reel, reel, reel, reel, reel],
  paylines: [], // scatter pays não usa paylines
  paytable: [], // idem
  scatterPays: [
    ...tiers(S.crown, 10),
    ...tiers(S.ring, 5),
    ...tiers(S.chalice, 4),
    ...tiers(S.hourglass, 3),
    ...tiers(S.red, 2),
    ...tiers(S.blue, 1.5),
    ...tiers(S.green, 1),
    ...tiers(S.purple, 0.8),
  ],
  scatter: { symbol: S.orb, countToTrigger: 4, freeSpinsAwarded: 8 },
  winMultiplier: { probability: 0.20, values: [2, 3, 5, 10, 25], weights: [50, 28, 14, 6, 2] },
  targetRtp: 0.965,
  volatility: "high",
  display: {
    symbols: {
      [S.crown]: "👑", [S.ring]: "💍", [S.chalice]: "🏆", [S.hourglass]: "⌛",
      [S.red]: "🔴", [S.blue]: "🔷", [S.green]: "💚", [S.purple]: "🟣", [S.orb]: "🔮",
    },
    labels: {
      [S.crown]: "Coroa", [S.ring]: "Anel", [S.chalice]: "Cálice", [S.hourglass]: "Ampulheta",
      [S.red]: "Rubi", [S.blue]: "Safira", [S.green]: "Esmeralda", [S.purple]: "Ametista", [S.orb]: "Orbe (free spins)",
    },
    gradient: "linear-gradient(165deg,#1a0b2e 0%,#2d1155 45%,#12061f 100%)",
    accent: "#a855f7",
  },
};
