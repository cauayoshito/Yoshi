/**
 * Motor de resolução: funções puras, sem estado, sem UI.
 * spin(config, rng) sorteia o grid; resolve(config, grid, rng) calcula prêmios.
 */
import type {
  GameConfig,
  LineWin,
  ReelWeights,
  SpinResult,
  SymbolId,
  ScatterPayTier,
  TumbleStep,
} from "./types.js";
import { InvalidGameConfigError } from "./types.js";
import type { RandomSource } from "./rng.js";

/** Valida a configuração — chame uma vez ao carregar o jogo. */
export function validateConfig(config: GameConfig): void {
  const { rows, cols, reels, symbols, paylines, paytable } = config;
  if (rows < 1 || cols < 1) throw new InvalidGameConfigError("grid deve ser >= 1x1");
  if (reels.length !== cols) {
    throw new InvalidGameConfigError(`reels.length (${reels.length}) difere de cols (${cols})`);
  }
  const known = new Set<SymbolId>(symbols);
  for (const [i, reel] of reels.entries()) {
    const total = Object.values(reel).reduce((a, w) => a + w, 0);
    if (total <= 0) throw new InvalidGameConfigError(`reel ${i} sem peso total positivo`);
    for (const sym of Object.keys(reel)) {
      if (!known.has(sym)) throw new InvalidGameConfigError(`reel ${i} usa símbolo desconhecido "${sym}"`);
    }
  }
  const cells = rows * cols;
  for (const [i, line] of paylines.entries()) {
    for (const cell of line) {
      if (cell < 0 || cell >= cells) {
        throw new InvalidGameConfigError(`payline ${i} referencia célula ${cell} fora do grid`);
      }
    }
  }
  for (const entry of paytable) {
    if (!known.has(entry.symbol)) {
      throw new InvalidGameConfigError(`paytable usa símbolo desconhecido "${entry.symbol}"`);
    }
    if (entry.multiplier <= 0 || entry.count < 1) {
      throw new InvalidGameConfigError(`entrada de paytable inválida para "${entry.symbol}"`);
    }
  }
  if (config.wild && !known.has(config.wild)) {
    throw new InvalidGameConfigError(`wild "${config.wild}" não está em symbols`);
  }
  if (config.scatter && !known.has(config.scatter.symbol)) {
    throw new InvalidGameConfigError(`scatter "${config.scatter.symbol}" não está em symbols`);
  }
  if (config.kind === "scatter-tumble") {
    if (!config.scatterPays || config.scatterPays.length === 0) {
      throw new InvalidGameConfigError("kind 'scatter-tumble' exige scatterPays");
    }
    for (const t of config.scatterPays) {
      if (!known.has(t.symbol)) throw new InvalidGameConfigError(`scatterPays usa símbolo desconhecido "${t.symbol}"`);
      if (t.minCount < 1 || t.multiplier <= 0) throw new InvalidGameConfigError(`faixa de scatterPays inválida para "${t.symbol}"`);
    }
  }
  if (config.winMultiplier) {
    const f = config.winMultiplier;
    if (f.values.length !== f.weights.length || f.values.length === 0) {
      throw new InvalidGameConfigError("winMultiplier.values/weights inconsistentes");
    }
    if (f.probability < 0 || f.probability > 1) {
      throw new InvalidGameConfigError("winMultiplier.probability fora de [0,1]");
    }
  }
  if (config.targetRtp <= 0 || config.targetRtp >= 1.5) {
    throw new InvalidGameConfigError("targetRtp deve estar em (0, 1.5)");
  }
}

/** Sorteio ponderado de um símbolo num reel. */
export function drawSymbol(reel: ReelWeights, rng: RandomSource): SymbolId {
  const entries = Object.entries(reel);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let roll = rng.next() * total;
  for (const [symbol, weight] of entries) {
    roll -= weight;
    if (roll < 0) return symbol;
  }
  // fallback numérico (roll == total por arredondamento)
  return entries[entries.length - 1]![0];
}

/** Sorteia o grid completo (row-major). */
export function spinGrid(config: GameConfig, rng: RandomSource): SymbolId[] {
  const grid: SymbolId[] = new Array(config.rows * config.cols);
  for (let col = 0; col < config.cols; col++) {
    const reel = config.reels[col]!;
    for (let row = 0; row < config.rows; row++) {
      grid[row * config.cols + col] = drawSymbol(reel, rng);
    }
  }
  return grid;
}

/**
 * Resolve as paylines de um grid: para cada linha, conta a sequência do
 * primeiro símbolo (da esquerda), com wild substituindo símbolos comuns.
 * Função pura — recebe grid, devolve prêmios.
 */
export function resolveLines(config: GameConfig, grid: readonly SymbolId[]): LineWin[] {
  const wins: LineWin[] = [];
  const wild = config.wild;
  const scatterSym = config.scatter?.symbol;

  for (const [lineIndex, line] of config.paylines.entries()) {
    const lineSymbols = line.map((cell) => grid[cell]!);

    // símbolo-base da linha: primeiro não-wild (wilds à esquerda assumem o próximo)
    let base: SymbolId | undefined;
    for (const s of lineSymbols) {
      if (s !== wild) { base = s; break; }
    }
    if (base === undefined) base = wild; // linha inteira de wilds
    if (base === undefined || base === scatterSym) continue; // scatter não paga em linha

    let count = 0;
    for (const s of lineSymbols) {
      if (s === base || (wild !== undefined && s === wild)) count++;
      else break;
    }

    // melhor entrada da paytable para (base, count exato)
    const entry = config.paytable.find((p) => p.symbol === base && p.count === count);
    if (entry) {
      wins.push({
        lineIndex,
        symbol: base,
        count,
        multiplier: entry.multiplier,
        cells: line.slice(0, count),
      });
    }
  }
  return wins;
}

/** Conta scatters em qualquer posição do grid. */
export function countScatters(config: GameConfig, grid: readonly SymbolId[]): number {
  const sym = config.scatter?.symbol;
  if (!sym) return 0;
  return grid.filter((s) => s === sym).length;
}

/** Sorteio ponderado do multiplicador da feature. */
function drawFeatureMultiplier(config: GameConfig, rng: RandomSource): number {
  const f = config.winMultiplier;
  if (!f) return 1;
  if (rng.next() >= f.probability) return 1;
  const total = f.weights.reduce((a, w) => a + w, 0);
  let roll = rng.next() * total;
  for (let i = 0; i < f.values.length; i++) {
    roll -= f.weights[i]!;
    if (roll < 0) return f.values[i]!;
  }
  return f.values[f.values.length - 1]!;
}

/**
 * Scatter pays: paga por QUANTIDADE de cada símbolo no grid, em qualquer
 * posição. Retorna o multiplicador total e as células vencedoras.
 */
export function resolveScatterPays(
  config: GameConfig,
  grid: readonly SymbolId[]
): { multiplier: number; cells: number[] } {
  const tiers = config.scatterPays ?? [];
  if (tiers.length === 0) return { multiplier: 0, cells: [] };

  const counts = new Map<SymbolId, number>();
  for (const s of grid) counts.set(s, (counts.get(s) ?? 0) + 1);

  let multiplier = 0;
  const winningSymbols = new Set<SymbolId>();
  // por símbolo, escolhe a MELHOR faixa cuja minCount é satisfeita
  const bySymbol = new Map<SymbolId, ScatterPayTier>();
  for (const tier of tiers) {
    const n = counts.get(tier.symbol) ?? 0;
    if (n >= tier.minCount) {
      const prev = bySymbol.get(tier.symbol);
      if (!prev || tier.minCount > prev.minCount) bySymbol.set(tier.symbol, tier);
    }
  }
  for (const [symbol, tier] of bySymbol) {
    multiplier += tier.multiplier;
    winningSymbols.add(symbol);
  }

  const cells: number[] = [];
  grid.forEach((s, i) => {
    if (winningSymbols.has(s)) cells.push(i);
  });
  return { multiplier, cells };
}

/**
 * Tumble/cascade: remove as células vencedoras e faz os símbolos caírem;
 * o topo é preenchido com novos sorteios daquele reel. Retorna o novo grid.
 */
function cascade(config: GameConfig, grid: readonly SymbolId[], winning: readonly number[], rng: RandomSource): SymbolId[] {
  const { rows, cols } = config;
  const win = new Set(winning);
  const next = grid.slice();
  for (let col = 0; col < cols; col++) {
    // símbolos sobreviventes da coluna, de baixo para cima
    const survivors: SymbolId[] = [];
    for (let row = rows - 1; row >= 0; row--) {
      const i = row * cols + col;
      if (!win.has(i)) survivors.push(next[i]!);
    }
    // reescreve a coluna: sobreviventes embaixo, novos no topo
    for (let row = rows - 1, k = 0; row >= 0; row--, k++) {
      const i = row * cols + col;
      next[i] = k < survivors.length ? survivors[k]! : drawSymbol(config.reels[col]!, rng);
    }
  }
  return next;
}

/**
 * Um spin no modo scatter-tumble: avalia scatter pays, cai a cascata e
 * repete enquanto houver ganho; ao final aplica o multiplicador aleatório
 * sobre o total. Determinístico para um RandomSource determinístico.
 */
export function playScatterTumble(config: GameConfig, rng: RandomSource): SpinResult {
  let grid = spinGrid(config, rng);
  const tumbles: TumbleStepMut[] = [];
  let baseMultiplier = 0;
  const MAX_TUMBLES = 30; // trava de segurança

  for (let step = 0; step < MAX_TUMBLES; step++) {
    const { multiplier, cells } = resolveScatterPays(config, grid);
    if (multiplier <= 0 || cells.length === 0) break;
    tumbles.push({ grid: grid.slice(), winningCells: cells.slice(), stepMultiplier: multiplier });
    baseMultiplier += multiplier;
    grid = cascade(config, grid, cells, rng);
  }

  const featureMultiplier = baseMultiplier > 0 ? drawFeatureMultiplier(config, rng) : 1;
  const scatters = countScatters(config, grid);
  const freeSpinsAwarded =
    config.scatter && scatters >= config.scatter.countToTrigger ? config.scatter.freeSpinsAwarded : 0;

  return {
    grid,
    lineWins: [],
    baseMultiplier,
    featureMultiplier,
    totalMultiplier: baseMultiplier * featureMultiplier,
    scatters,
    freeSpinsAwarded,
    tumbles,
  };
}

type TumbleStepMut = { grid: SymbolId[]; winningCells: number[]; stepMultiplier: number };

/**
 * Um spin completo: despacha por mecânica (paylines ou scatter-tumble).
 * Determinístico para um RandomSource determinístico (provably fair).
 */
export function playSpin(config: GameConfig, rng: RandomSource): SpinResult {
  if (config.kind === "scatter-tumble") return playScatterTumble(config, rng);
  const grid = spinGrid(config, rng);
  const lineWins = resolveLines(config, grid);
  const baseMultiplier = lineWins.reduce((a, w) => a + w.multiplier, 0);

  const featureMultiplier = baseMultiplier > 0 ? drawFeatureMultiplier(config, rng) : 1;

  const scatters = countScatters(config, grid);
  const freeSpinsAwarded =
    config.scatter && scatters >= config.scatter.countToTrigger
      ? config.scatter.freeSpinsAwarded
      : 0;

  return {
    grid,
    lineWins,
    baseMultiplier,
    featureMultiplier,
    totalMultiplier: baseMultiplier * featureMultiplier,
    scatters,
    freeSpinsAwarded,
  };
}
