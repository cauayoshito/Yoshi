/**
 * Modelo de configuração de jogo — 100% declarativo.
 * Um novo jogo temático é um novo GameConfig, nunca código novo na engine.
 */

export type SymbolId = string;

/** Pesos de probabilidade de cada símbolo em UM reel (coluna). */
export type ReelWeights = Readonly<Record<SymbolId, number>>;

/** Entrada da paytable: N símbolos iguais numa payline → multiplicador da aposta. */
export interface PaytableEntry {
  readonly symbol: SymbolId;
  readonly count: number;
  /** Multiplicador aplicado à aposta total da rodada. */
  readonly multiplier: number;
}

/** Feature "multiplicador aleatório" (assinatura do gênero Fortune). */
export interface WinMultiplierFeature {
  /** Probabilidade de ativar quando a rodada tem ganho (0–1). */
  readonly probability: number;
  readonly values: readonly number[];
  /** Pesos paralelos a `values`. */
  readonly weights: readonly number[];
}

/** Free spins disparados por N scatters em qualquer posição. */
export interface ScatterFeature {
  readonly symbol: SymbolId;
  readonly countToTrigger: number;
  readonly freeSpinsAwarded: number;
}

export type Volatility = "low" | "medium" | "high";

export interface GameConfig {
  readonly id: string;
  readonly name: string;
  readonly rows: number;
  readonly cols: number;
  /** Símbolos válidos do jogo (inclui wild/scatter se houver). */
  readonly symbols: readonly SymbolId[];
  /** Pesos por reel — `reels.length === cols`. */
  readonly reels: readonly ReelWeights[];
  /**
   * Paylines como índices no grid achatado (row-major:
   * índice = row * cols + col).
   */
  readonly paylines: readonly (readonly number[])[];
  readonly paytable: readonly PaytableEntry[];
  /** Símbolo curinga: substitui qualquer símbolo comum (nunca o scatter). */
  readonly wild?: SymbolId;
  readonly scatter?: ScatterFeature;
  readonly winMultiplier?: WinMultiplierFeature;
  /** RTP alvo (ex.: 0.965). O simulador valida a paytable contra ele. */
  readonly targetRtp: number;
  readonly volatility: Volatility;
}

/** Uma linha premiada na resolução. */
export interface LineWin {
  readonly lineIndex: number;
  readonly symbol: SymbolId;
  readonly count: number;
  readonly multiplier: number;
  readonly cells: readonly number[];
}

/** Resultado completo de um spin. */
export interface SpinResult {
  /** Grid achatado (row-major), length = rows * cols. */
  readonly grid: readonly SymbolId[];
  readonly lineWins: readonly LineWin[];
  /** Multiplicador base somado das linhas (antes da feature). */
  readonly baseMultiplier: number;
  /** Multiplicador da feature (1 quando não ativou). */
  readonly featureMultiplier: number;
  /** Multiplicador final: base * feature. Payout = aposta * totalMultiplier. */
  readonly totalMultiplier: number;
  readonly scatters: number;
  readonly freeSpinsAwarded: number;
}

/** Erros de configuração detectados na validação. */
export class InvalidGameConfigError extends Error {
  constructor(message: string) {
    super(`GameConfig inválido: ${message}`);
    this.name = "InvalidGameConfigError";
  }
}
