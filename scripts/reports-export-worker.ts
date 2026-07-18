import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const { processReportExportJobs } = await import("@/domains/reports/export-jobs");
  console.log(JSON.stringify({ reportExports: "completed", result: await processReportExportJobs() }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
