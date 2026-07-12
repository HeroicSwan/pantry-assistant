import { getServerEnvironment } from "@/lib/env";
import { pool } from "@/lib/database/client";
import { processForecastJob } from "@/domains/forecasting/service";

async function run(request: Request) {
  const secret = getServerEnvironment().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const jobs = await pool.query<{ id: string }>("select id from forecast_jobs where status='queued' order by requested_at limit 25");
  let processed = 0;
  for (const job of jobs.rows) { await processForecastJob(job.id); processed += 1; }
  return Response.json({ processed });
}

export const GET = run;
export const POST = run;
