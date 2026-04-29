import { loadConfig } from "../config.js";
import { runMigrations } from "../storage/postgres.js";

const config = loadConfig();

if (!config.databaseUrl) {
  console.log("DATABASE_URL is not set; no Postgres migrations were run.");
} else {
  await runMigrations(config.databaseUrl);
  console.log("Postgres migrations complete.");
}
