import { config } from "dotenv";
config({path:".env.local",quiet:true});

async function main() {
  const { pool } = await import("@/lib/database/client");
  const { processForecastJob } = await import("@/domains/forecasting/service");

  try {
    const jobs = await pool.query<{ id: string }>("select id from forecast_jobs where status='queued' order by requested_at limit 25");
    for (const job of jobs.rows) await processForecastJob(job.id);
    console.log(`forecast-jobs-processed:${jobs.rowCount}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
