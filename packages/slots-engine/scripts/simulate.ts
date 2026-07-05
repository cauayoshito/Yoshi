/**
 * CLI do simulador de RTP.
 *   npm run simulate                     # 2M spins no Yoshi Fortune
 *   npm run simulate -- 10000000         # N spins
 */
import { simulate, formatReport } from "../src/simulator.js";
import { validateConfig } from "../src/engine.js";
import { yoshiFortune } from "../games/yoshi-fortune.js";

const spins = Number(process.argv[2]) || 2_000_000;

validateConfig(yoshiFortune);
const started = Date.now();
const report = simulate(yoshiFortune, spins);
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(formatReport(report));
console.log(`   (${spins.toLocaleString("en-US")} spins simulados em ${elapsed}s)`);

process.exitCode = report.deviationPp <= 0.5 ? 0 : 1;
