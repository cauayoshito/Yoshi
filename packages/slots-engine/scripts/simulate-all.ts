import { simulate } from "../src/simulator.js";
import { validateConfig } from "../src/engine.js";
import { yoshiFortune } from "../games/yoshi-fortune.js";
import { themedGames } from "../games/themed.js";
import { dragonsHoard } from "../games/dragons-hoard.js";

for (const game of [yoshiFortune, ...themedGames, dragonsHoard]) {
  validateConfig(game);
  const r = simulate(game, 2_000_000);
  console.log(`${game.name.padEnd(16)} RTP ${(r.rtp*100).toFixed(3)}% (alvo ${(r.targetRtp*100).toFixed(1)}%, desvio ${r.deviationPp.toFixed(3)}pp, hit ${(r.hitRate*100).toFixed(1)}%, maxWin ${r.maxWinMultiplier.toFixed(0)}x) ${r.deviationPp<=0.5?"OK":"ajustar"}`);
}
