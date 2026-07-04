import { createApp } from "./app.js";
import { config } from "./config.js";
import { settleFinishedMatches } from "./services/sports.js";

const app = createApp();

// Liquidação automática: no boot e a cada 60s
function runSettlement() {
  try {
    const settled = settleFinishedMatches();
    for (const s of settled) {
      console.log(`⚽ Liquidado ${s.matchId}: ${s.homeScore}x${s.awayScore} (${s.outcome}) — ${s.won} ganhas, ${s.lost} perdidas`);
    }
  } catch (err) {
    console.error("Erro na liquidação:", err.message);
  }
}
runSettlement();
setInterval(runSettlement, 60_000).unref();

app.listen(config.port, () => {
  console.log(`🐲 YOSHI BET rodando em http://localhost:${config.port}`);
  console.log(`   API:      http://localhost:${config.port}/api/health`);
  console.log(`   Banco:    ${config.dbPath}`);
});
