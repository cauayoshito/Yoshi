/**
 * Simulador de RTP: roda N spins contra um GameConfig e mede o RTP real,
 * hit rate, distribuição de prêmios e contribuição dos free spins.
 * Use antes de qualquer jogo ir ao ar — e guarde o relatório para auditoria.
 */
import type { GameConfig } from "./types.js";
import { playSpin } from "./engine.js";
import { CryptoRNG, type RandomSource } from "./rng.js";

export interface SimulationReport {
  readonly gameId: string;
  readonly spins: number;
  /** Spins pagos (exclui free spins, que não custam aposta). */
  readonly paidSpins: number;
  readonly freeSpinsPlayed: number;
  readonly totalBet: number;
  readonly totalPayout: number;
  readonly rtp: number;
  readonly targetRtp: number;
  /** |rtp - targetRtp| em pontos percentuais. */
  readonly deviationPp: number;
  readonly hitRate: number;
  readonly maxWinMultiplier: number;
  readonly featureTriggerRate: number;
  readonly freeSpinTriggerRate: number;
  /** Desvio padrão do multiplicador por spin pago (proxy de volatilidade). */
  readonly stdDev: number;
}

export function simulate(
  config: GameConfig,
  paidSpins: number,
  rng: RandomSource = new CryptoRNG()
): SimulationReport {
  let totalPayout = 0;
  let hits = 0;
  let featureTriggers = 0;
  let freeSpinTriggers = 0;
  let freeSpinsPlayed = 0;
  let maxWin = 0;
  let sumSq = 0;

  // fila de free spins pendentes (free spins também podem re-disparar)
  let pendingFree = 0;
  const MAX_FREE_CHAIN = 1000; // trava de segurança contra config degenerada

  for (let i = 0; i < paidSpins; i++) {
    let spinPayout = 0;

    const result = playSpin(config, rng);
    spinPayout += result.totalMultiplier;
    if (result.totalMultiplier > 0) hits++;
    if (result.featureMultiplier > 1) featureTriggers++;
    if (result.freeSpinsAwarded > 0) {
      freeSpinTriggers++;
      pendingFree += result.freeSpinsAwarded;
    }

    let chain = 0;
    while (pendingFree > 0 && chain < MAX_FREE_CHAIN) {
      pendingFree--;
      chain++;
      freeSpinsPlayed++;
      const free = playSpin(config, rng);
      spinPayout += free.totalMultiplier;
      if (free.freeSpinsAwarded > 0) pendingFree += free.freeSpinsAwarded;
    }
    pendingFree = 0;

    totalPayout += spinPayout;
    maxWin = Math.max(maxWin, spinPayout);
    sumSq += spinPayout * spinPayout;
  }

  const totalBet = paidSpins;
  const rtp = totalPayout / totalBet;
  const mean = totalPayout / paidSpins;
  const variance = sumSq / paidSpins - mean * mean;

  return {
    gameId: config.id,
    spins: paidSpins + freeSpinsPlayed,
    paidSpins,
    freeSpinsPlayed,
    totalBet,
    totalPayout,
    rtp,
    targetRtp: config.targetRtp,
    deviationPp: Math.abs(rtp - config.targetRtp) * 100,
    hitRate: hits / paidSpins,
    maxWinMultiplier: maxWin,
    featureTriggerRate: featureTriggers / paidSpins,
    freeSpinTriggerRate: freeSpinTriggers / paidSpins,
    stdDev: Math.sqrt(Math.max(0, variance)),
  };
}

export function formatReport(r: SimulationReport): string {
  const pct = (v: number, d = 2) => `${(v * 100).toFixed(d)}%`;
  return [
    `┌─ Simulação de RTP — ${r.gameId}`,
    `│ Spins pagos:        ${r.paidSpins.toLocaleString("en-US")}`,
    `│ Free spins jogados: ${r.freeSpinsPlayed.toLocaleString("en-US")}`,
    `│ RTP medido:         ${pct(r.rtp, 3)}  (alvo ${pct(r.targetRtp, 1)}, desvio ${r.deviationPp.toFixed(3)} p.p.)`,
    `│ Hit rate:           ${pct(r.hitRate)}`,
    `│ Trigger da feature: ${pct(r.featureTriggerRate)} dos spins`,
    `│ Trigger free spins: ${pct(r.freeSpinTriggerRate, 3)} dos spins`,
    `│ Maior prêmio:       ${r.maxWinMultiplier.toFixed(0)}x a aposta`,
    `│ Desvio padrão:      ${r.stdDev.toFixed(2)} (volatilidade ${r.stdDev > 6 ? "alta" : r.stdDev > 3 ? "média" : "baixa"})`,
    `└─ ${r.deviationPp <= 0.5 ? "✅ dentro da tolerância (±0,5 p.p.)" : "⚠️ FORA da tolerância — ajuste a paytable"}`,
  ].join("\n");
}
