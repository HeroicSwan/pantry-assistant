import { resolve } from "node:path";
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const command = process.argv[2];
const testTarget = command?.startsWith("test-") ?? false;
const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
const connectionString = testTarget ? testUrl : developmentUrl;

if (!connectionString) throw new Error(`${testTarget ? "TEST_DATABASE_URL" : "DATABASE_URL"} is required.`);

const parsed = new URL(connectionString);
const databaseName = parsed.pathname.slice(1);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) throw new Error("Database commands accept local PostgreSQL URLs only.");
if (testTarget) {
  if (process.env.NODE_ENV !== "test") throw new Error("Test database commands require NODE_ENV=test.");
  if (!testUrl || testUrl === developmentUrl || !databaseName.endsWith("_test")) throw new Error("The isolated _test database is required.");
} else if (databaseName !== "food_pantry_dev") {
  throw new Error("Development commands require food_pantry_dev.");
}

async function main() {
  const pool = new Pool({ connectionString, max: 2, application_name: `pantry-db-${command}` });
  try {
  if (command === "migrate" || command === "test-migrate") {
    await migrate(drizzle(pool), { migrationsFolder: resolve(process.cwd(), "drizzle") });
    console.log(`migrated:${databaseName}`);
  } else if (command === "status" || command === "test-status") {
    const result = await pool.query<{ migration_count: string; table_count: string }>(`
      select
        (select count(*)::text from drizzle.__drizzle_migrations) as migration_count,
        (select count(*)::text from information_schema.tables where table_schema = 'public') as table_count
    `);
    console.log(`status:${databaseName}:migrations=${result.rows[0]?.migration_count}:tables=${result.rows[0]?.table_count}`);
  } else if (command === "test-reset") {
    await pool.query("drop schema if exists drizzle cascade; drop schema public cascade; create schema public authorization pantry_app;");
    console.log(`reset:${databaseName}`);
  } else {
    throw new Error("Use migrate, status, test-migrate, test-status, or test-reset.");
  }
  } finally {
    await pool.end();
  }
}

void main();
