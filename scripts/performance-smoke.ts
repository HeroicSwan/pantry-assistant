import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });

const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;
if (process.env.NODE_ENV !== "test")
  throw new Error("Performance smoke tests require NODE_ENV=test.");
if (!testUrl || !developmentUrl || testUrl === developmentUrl)
  throw new Error("A distinct TEST_DATABASE_URL is required.");
const parsed = new URL(testUrl);
if (
  !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
  !parsed.pathname.endsWith("_test")
)
  throw new Error("Performance smoke tests require a local *_test database.");

const itemCount = Number(process.env.PERFORMANCE_ITEM_COUNT ?? 2500);
const maximumMilliseconds = Number(process.env.PERFORMANCE_MAX_MS ?? 5000);
if (!Number.isInteger(itemCount) || itemCount < 100 || itemCount > 10000)
  throw new Error(
    "PERFORMANCE_ITEM_COUNT must be an integer from 100 through 10,000.",
  );
if (!Number.isFinite(maximumMilliseconds) || maximumMilliseconds < 100)
  throw new Error("PERFORMANCE_MAX_MS must be at least 100.");

process.env.DATABASE_URL = testUrl;
const controlPool = new Pool({
  connectionString: testUrl,
  max: 2,
  application_name: "pantry-performance-smoke",
});
const prefix = `perf-${crypto.randomUUID()}`;

async function main() {
  const [{ pool: applicationPool }, { listItemsWithBalances }] =
    await Promise.all([
      import("@/lib/database/client"),
      import("@/domains/inventory/queries"),
    ]);
  try {
    const identities = await controlPool.query<{
      organization_id: string;
      pantry_location_id: string;
      unit_id: string;
      user_id: string;
    }>(`
      select o.id organization_id, l.id pantry_location_id, u.id unit_id, p.id user_id
      from organizations o
      join pantry_locations l on l.organization_id=o.id and l.status='active'
      join units_of_measure u on u.organization_id=o.id
      join user_profiles p on p.id=(select id from "user" order by created_at limit 1)
      order by o.created_at, l.created_at, u.created_at
      limit 1
    `);
    const identity = identities.rows[0];
    if (!identity)
      throw new Error(
        "Seeded test data is required. Run pnpm db:test:seed first.",
      );

    await controlPool.query(
      `
      insert into inventory_items(organization_id,name,sku,base_unit_id,tracks_expiration,created_by)
      select $1::uuid, concat('Performance ', $4::text, ' item ', series), concat($4::text, '-', series), $3::uuid, false, $5::uuid
      from generate_series(1,$2::int) series
    `,
      [
        identity.organization_id,
        itemCount,
        identity.unit_id,
        prefix,
        identity.user_id,
      ],
    );

    const started = performance.now();
    const items = await listItemsWithBalances(
      identity.organization_id,
      identity.pantry_location_id,
      { query: prefix, stock: "all" },
    );
    const elapsedMilliseconds = Math.round(performance.now() - started);
    if (items.length !== itemCount)
      throw new Error(
        `Expected ${itemCount} imported performance items, received ${items.length}.`,
      );
    if (elapsedMilliseconds > maximumMilliseconds)
      throw new Error(
        `Inventory list query took ${elapsedMilliseconds}ms (limit ${maximumMilliseconds}ms).`,
      );
    console.log(
      `performance:inventory-list:items=${itemCount}:elapsedMs=${elapsedMilliseconds}:limitMs=${maximumMilliseconds}`,
    );
  } finally {
    await controlPool.query("delete from inventory_items where sku like $1", [`${prefix}-%`]);
    await Promise.allSettled([controlPool.end(), applicationPool?.end()]);
  }
}

void main();
