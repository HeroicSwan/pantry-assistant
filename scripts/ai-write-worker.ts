import { config } from "dotenv";
import { pool } from "@/lib/database/client";

config({ path: ".env.local", quiet: true });

async function main() {
  const { executeAutonomousWrite } = await import("@/domains/assistant/autonomous");
  const actions = await pool.query<{ id: string }>(`select id from ai_write_actions where status='pending' and autonomous order by created_at for update skip locked limit 25`);
  let completed = 0;
  for (const action of actions.rows) { await executeAutonomousWrite(action.id); completed += 1; }
  console.log(JSON.stringify({ autonomousWrites: completed }));
  await pool.end();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
