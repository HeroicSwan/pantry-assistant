import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const { generateRecurringAppointments } = await import("@/domains/pickups/recurrence");
  const result = await generateRecurringAppointments();
  console.log(JSON.stringify({ recurringAppointments: "completed", result }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
