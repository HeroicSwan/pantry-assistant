import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getServerEnvironment } from "@/lib/env";
import * as schema from "@/lib/database/schema";

const globalDatabase = globalThis as typeof globalThis & { pantryPool?: Pool };

export const pool =
  globalDatabase.pantryPool ??
  new Pool({
    connectionString: getServerEnvironment().DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "food-pantry-nextjs",
  });

if (process.env.NODE_ENV !== "production") globalDatabase.pantryPool = pool;

export const db = drizzle(pool, { schema });
export type Database = typeof db;
