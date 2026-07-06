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

/**
 * Mecânica do jogo:
 * - "lines": paylines fixas (estilo Fortune Tiger). Padrão.
 * - "scatter-tumble": paga por QUANTIDADE do símbolo em qualquer posição
 *   (scatter pays) e faz tumble/cascade — símbolos vencedores somem e caem
 *   novos, repetindo enquanto houver ganho (estilo Gates of Olympus).
 */
export type GameKind = "lines" | "scatter-tumble";

/** Faixa de pagamento por quantidade (scatter pays). */
export interface ScatterPayTier {
  readonly symbol: SymbolId;
  /** quantidade mínima do símbolo no grid para pagar esta faixa. */
  readonly minCount: number;
  /** multiplicador da aposta total. */
  readonly multiplier: number;
}

/** Um passo do tumble (para o cliente animar a cascata). */
export interface TumbleStep {
  readonly grid: readonly SymbolId[];
  readonly winningCells: readonly number[];
  readonly stepMultiplier: number;
}

export interface GameConfig {
  readonly id: string;
  readonly name: string;
  readonly kind?: GameKind;
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
  /** Faixas de pagamento por quantidade — usado quando kind = "scatter-tumble". */
  readonly scatterPays?: readonly ScatterPayTier[];
  /** Símbolo curinga: substitui qualquer símbolo comum (nunca o scatter). */
  readonly wild?: SymbolId;
  readonly scatter?: ScatterFeature;
  readonly winMultiplier?: WinMultiplierFeature;
  /** RTP alvo (ex.: 0.965). O simulador valida a paytable contra ele. */
  readonly targetRtp: number;
  readonly volatility: Volatility;
  /**
   * Metadados de apresentação — a engine IGNORA no cálculo; o cliente usa
   * para renderizar. Mantém "config, não código": um jogo temático novo é só
   * um GameConfig novo, sem tocar no front.
   */
  readonly display?: {
    /** emoji/ícone por símbolo (ex.: { tiger: "🐯" }). */
    readonly symbols?: Readonly<Record<SymbolId, string>>;
    /** rótulo legível por símbolo. */
    readonly labels?: Readonly<Record<SymbolId, string>>;
    /** gradiente de fundo do jogo (CSS). */
    readonly gradient?: string;
    /** cor de destaque (glow/bordas). */
    readonly accent?: string;
  };
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
  /** Passos da cascata (só em jogos "scatter-tumble"). */
  readonly tumbles?: readonly TumbleStep[];
}

/** Erros de configuração detectados na validação. */
export class InvalidGameConfigError extends Error {
  constructor(message: string) {
    super(`GameConfig inválido: ${message}`);
    this.name = "InvalidGameConfigError";
  }
}
