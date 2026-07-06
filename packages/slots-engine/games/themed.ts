/**
 * Jogos temáticos da vitrine — IP própria, provably fair.
 *
 * Reusam a MESMA matemática auditada do Yoshi Fortune (mesmos pesos por
 * reel, paytable e feature ⇒ RTP 96,5% validado), variando apenas tema,
 * símbolos e apresentação. É a prova viva do pitch: "jogo novo = config
 * nova, nunca código novo". Cada um é independentemente re-simulável.
 */
import type { GameConfig, SymbolId, ReelWeights, PaytableEntry } from "../src/types.js";

interface Theme {
  id: string;
  name: string;
  /** ordem: [wild, top, high, mid, low1, low2(base), scatter] */
  symbols: [SymbolId, SymbolId, SymbolId, SymbolId, SymbolId, SymbolId, SymbolId];
  emojis: [string, string, string, string, string, string, string];
  labels: [string, string, string, string, string, string, string];
  gradient: string;
  accent: string;
}

/** Constrói um GameConfig 3x3 / 5 linhas com a matemática de RTP 96,5%. */
function buildGame(t: Theme): GameConfig {
  const [wild, top, high, mid, low1, base, scatter] = t.symbols;

  const reel: ReelWeights = {
    [base]: 255, [low1]: 225, [mid]: 180, [high]: 130, [top]: 85, [wild]: 45, [scatter]: 80,
  };
  const reelMid: ReelWeights = { ...reel, [wild]: 65 };

  const paytable: PaytableEntry[] = [
    { symbol: wild, count: 3, multiplier: 25 },
    { symbol: top, count: 3, multiplier: 10 },
    { symbol: high, count: 3, multiplier: 5 },
    { symbol: mid, count: 3, multiplier: 2.5 },
    { symbol: low1, count: 3, multiplier: 1.5 },
    { symbol: base, count: 3, multiplier: 1 },
  ];

  const symbolsMap: Record<SymbolId, string> = {};
  const labelsMap: Record<SymbolId, string> = {};
  t.symbols.forEach((s, i) => {
    symbolsMap[s] = t.emojis[i]!;
    labelsMap[s] = t.labels[i]!;
  });
  const display: NonNullable<GameConfig["display"]> = {
    symbols: symbolsMap,
    labels: labelsMap,
    gradient: t.gradient,
    accent: t.accent,
  };

  return {
    id: t.id,
    name: t.name,
    rows: 3,
    cols: 3,
    symbols: t.symbols,
    reels: [reel, reelMid, reel],
    paylines: [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 4, 8], [2, 4, 6]],
    paytable,
    wild,
    scatter: { symbol: scatter, countToTrigger: 4, freeSpinsAwarded: 6 },
    winMultiplier: { probability: 0.145, values: [2, 3, 5, 10], weights: [55, 27, 13, 5] },
    targetRtp: 0.965,
    volatility: "medium",
    display,
  };
}

export const luckyTiger = buildGame({
  id: "lucky-tiger",
  name: "Lucky Tiger",
  symbols: ["tiger", "goldbar", "lantern", "coin", "peach", "drum", "medal"],
  emojis: ["🐯", "🪙", "🏮", "💰", "🍑", "🥁", "🏅"],
  labels: ["Tigre (wild)", "Moeda de ouro", "Lanterna", "Saco de ouro", "Pêssego", "Tambor", "Medalha (scatter)"],
  gradient: "linear-gradient(165deg,#3a1403 0%,#5c2306 45%,#241000 100%)",
  accent: "#ff9d00",
});

export const goldenDragon = buildGame({
  id: "golden-dragon",
  name: "Golden Dragon",
  symbols: ["dragon", "pearl", "sycee", "fan", "koi", "cloud", "gong"],
  emojis: ["🐉", "🫧", "🪙", "🪭", "🐟", "☁️", "🔔"],
  labels: ["Dragão (wild)", "Pérola", "Lingote", "Leque", "Carpa", "Nuvem", "Gongo (scatter)"],
  gradient: "linear-gradient(165deg,#04231a 0%,#0a4d38 45%,#031f17 100%)",
  accent: "#22d3a8",
});

export const mysticOx = buildGame({
  id: "mystic-ox",
  name: "Mystic Ox",
  symbols: ["ox", "ingot2", "bell2", "coin2", "grain", "flower", "scroll2"],
  emojis: ["🐂", "🧧", "🔔", "🪙", "🌾", "🌸", "📜"],
  labels: ["Touro (wild)", "Envelope", "Sino", "Moeda", "Trigo", "Flor", "Pergaminho (scatter)"],
  gradient: "linear-gradient(165deg,#2a1a04 0%,#4d3308 45%,#1f1403 100%)",
  accent: "#e0b010",
});

export const themedGames = [luckyTiger, goldenDragon, mysticOx];
