// @vitest-environment node
import { config } from "dotenv";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";

config({ path: ".env.local", quiet: true });
const developmentUrl=process.env.DATABASE_URL;const testUrl=process.env.TEST_DATABASE_URL;
if(!developmentUrl||!testUrl)throw new Error("Native PostgreSQL test environment is incomplete.");
const parsed=new URL(testUrl);if(!["localhost","127.0.0.1"].includes(parsed.hostname)||!parsed.pathname.endsWith("_test")||testUrl===developmentUrl)throw new Error("Integration tests require the distinct local *_test database.");
process.env.DATABASE_URL=testUrl;
const pool=new Pool({connectionString:testUrl,max:3});
const ids={harbor:"20000000-0000-4000-8000-000000000001",downtown:"30000000-0000-4000-8000-000000000001",admin:"10000000-0000-4000-8000-000000000001",unrelated:"10000000-0000-4000-8000-000000000007"};

describe.sequential("deterministic forecast system",()=>{
  afterAll(async()=>pool.end());
  it("generates immutable item/category snapshots and diagnostics from canonical inputs",async()=>{const{generateForecast}=await import("@/domains/forecasting/service");const snapshot=await generateForecast(ids.admin,ids.harbor,ids.downtown,crypto.randomUUID());const itemCount=await pool.query("select 1 from forecast_item_results where snapshot_id=$1",[snapshot.id]);const categoryCount=await pool.query("select 1 from forecast_category_results where snapshot_id=$1",[snapshot.id]);expect(itemCount.rowCount).toBeGreaterThan(0);expect(categoryCount.rowCount).toBeGreaterThan(0);const rice=await pool.query<{scheduled_demand:string;scheduled_reserved:string;scheduled_unreserved:string;explanation:Record<string,unknown>}>("select scheduled_demand::text,scheduled_reserved::text,scheduled_unreserved::text,explanation from forecast_item_results where snapshot_id=$1 and inventory_item_id=(select id from inventory_items where organization_id=$2 and name='Rice (5 lb bag)')",[snapshot.id,ids.harbor]);expect(Number(rice.rows[0]!.scheduled_reserved)+Number(rice.rows[0]!.scheduled_unreserved)).toBe(Number(rice.rows[0]!.scheduled_demand));expect(rice.rows[0]!.explanation).toHaveProperty("classification");await expect(pool.query("update forecast_snapshots set calculation_version='tampered' where id=$1",[snapshot.id])).rejects.toMatchObject({message:"FORECAST_SNAPSHOT_IMMUTABLE"});});
  it("deduplicates jobs and forecast alerts",async()=>{const{processForecastJob,queueForecast}=await import("@/domains/forecasting/service");const first=await queueForecast(ids.admin,ids.harbor,ids.downtown,crypto.randomUUID());const duplicate=await queueForecast(ids.admin,ids.harbor,ids.downtown,crypto.randomUUID());expect(duplicate.id).toBe(first.id);await processForecastJob(first.id);const alerts=await pool.query<{fingerprint:string;occurrence_count:number}>("select fingerprint,occurrence_count from operational_alerts where organization_id=$1",[ids.harbor]);expect(new Set(alerts.rows.map(row=>row.fingerprint)).size).toBe(alerts.rowCount);});
  it("blocks cross-organization recalculation",async()=>{const{generateForecast}=await import("@/domains/forecasting/service");await expect(generateForecast(ids.unrelated,ids.harbor,ids.downtown,crypto.randomUUID())).rejects.toMatchObject({message:"FORBIDDEN"});});
});
