import { simulate, formatReport } from "../src/simulator.js";
import { validateConfig } from "../src/engine.js";
import { yoshiFortune } from "../games/yoshi-fortune.js";
import { themedGames } from "../games/themed.js";

for (const game of [yoshiFortune, ...themedGames]) {
  validateConfig(game);
  const r = simulate(game, 5_000_000);
  console.log(`${game.name.padEnd(16)} RTP ${(r.rtp*100).toFixed(3)}% (alvo ${(r.targetRtp*100).toFixed(1)}%, desvio ${r.deviationPp.toFixed(3)}pp) ${r.deviationPp<=0.5?"✅":"⚠️"}`);
}
