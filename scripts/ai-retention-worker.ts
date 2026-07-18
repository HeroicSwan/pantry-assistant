import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const { getServerEnvironment } = await import("@/lib/env");
  const { archiveExpiredAssistantConversations } = await import("@/domains/assistant/retention");
  const result = await archiveExpiredAssistantConversations(getServerEnvironment().AI_CONVERSATION_RETENTION_DAYS);
  console.log(JSON.stringify({ aiRetention: "completed", result }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
