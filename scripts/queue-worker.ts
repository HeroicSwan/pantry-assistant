import { config } from "dotenv";
import { claimJob, completeJob, failJob } from "@/lib/jobs/queue";

config({ path: ".env.local", quiet: true });

async function main() {
  const queueName = process.argv[2] ?? "default";
  const limit = Math.min(Math.max(Number(process.argv[3] ?? 10), 1), 100);
  const workerId = `pantry-${process.pid}-${Date.now()}`;
  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const job = await claimJob(queueName, workerId);
    if (!job) break;
    try {
      if (job.job_type === "forecast") {
        const { processForecastJob } = await import("@/domains/forecasting/service");
        await processForecastJob(String(job.payload.forecastJobId));
      } else if (job.job_type === "automation") {
        const { processAutomationRun } = await import("@/domains/automation/service");
        await processAutomationRun(String(job.payload.runId));
      } else if (job.job_type === "report_export") {
        const { processReportExportJobs } = await import("@/domains/reports/export-jobs");
        await processReportExportJobs(1);
      } else if (job.job_type === "messaging") {
        const { runMessagingJobs } = await import("@/domains/messaging/service");
        await runMessagingJobs();
      } else {
        throw new Error(`UNKNOWN_QUEUE_JOB:${job.job_type}`);
      }
      await completeJob(job.id);
      processed += 1;
    } catch (error) {
      await failJob(job, error);
    }
  }
  console.log(JSON.stringify({ queue: queueName, processed }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
