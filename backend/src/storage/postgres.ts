import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";

const { Pool } = pg;
const migrationsDir = join(process.cwd(), "migrations");
const pools = new Map<string, pg.Pool>();

export function getPool(databaseUrl: string): pg.Pool {
  let pool = pools.get(databaseUrl);
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? undefined : { rejectUnauthorized: false }
    });
    pools.set(databaseUrl, pool);
  }
  return pool;
}

export async function runMigrations(databaseUrl: string): Promise<void> {
  if (!databaseUrl) return;
  const pool = getPool(databaseUrl);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrations = ["001_app_storage.sql"];
  for (const version of migrations) {
    const applied = await pool.query("SELECT 1 FROM schema_migrations WHERE version = $1", [version]);
    if (applied.rowCount) continue;
    const sql = await readFile(join(migrationsDir, version), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}
