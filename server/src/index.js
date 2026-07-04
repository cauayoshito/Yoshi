import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`🐲 YOSHI BET rodando em http://localhost:${config.port}`);
  console.log(`   API:      http://localhost:${config.port}/api/health`);
  console.log(`   Banco:    ${config.dbPath}`);
});
