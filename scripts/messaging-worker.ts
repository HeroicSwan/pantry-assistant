import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const { runMessagingJobs } = await import("@/domains/messaging/service");
  const { pool } = await import("@/lib/database/client");

  try {
    const result = await runMessagingJobs();
    console.log(JSON.stringify({ messagingJobs: "completed", result }));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
