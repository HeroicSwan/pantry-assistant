import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";

export async function archiveExpiredAssistantConversations(retentionDays: number) {
  const days = Math.min(Math.max(Math.trunc(retentionDays), 7), 3650);
  const result = await db.execute<{ id: string }>(sql`
    update ai_conversations
       set status='archived', archived_at=now(), updated_at=now()
     where status='active' and archived_at is null and updated_at < now() - make_interval(days => ${days})
     returning id
  `);
  return { archived: result.rowCount ?? 0 };
}
