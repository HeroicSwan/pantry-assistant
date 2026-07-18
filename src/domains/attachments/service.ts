import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { hasLocationPermission } from "@/lib/database/authorization";
import { DomainError } from "@/lib/errors";

const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png", "text/plain", "text/csv"]);
const maxBytes = 50 * 1024 * 1024;

export async function storeAttachment(input: { actorId: string; organizationId: string; locationId: string; entityType: string; entityId: string; file: File }) {
  if (!(await hasLocationPermission(db, input.actorId, input.locationId, "attachment.manage"))) throw new DomainError("FORBIDDEN");
  if (!allowedTypes.has(input.file.type) || input.file.size <= 0 || input.file.size > maxBytes) throw new DomainError("VALIDATION_ERROR");
  if (!/^[a-z0-9_-]+$/.test(input.entityType)) throw new DomainError("VALIDATION_ERROR");
  const bytes = Buffer.from(await input.file.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  const storageKey = `${input.organizationId}/${randomUUID()}-${path.basename(input.file.name).replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const absolute = path.join(process.cwd(), "data", "attachments", storageKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes, { flag: "wx" });
  const result = await db.execute<{ id: string }>(sql`
    insert into file_attachments(organization_id,pantry_location_id,entity_type,entity_id,original_name,storage_key,content_type,byte_size,sha256,uploaded_by)
    values(${input.organizationId}::uuid,${input.locationId}::uuid,${input.entityType},${input.entityId}::uuid,${input.file.name},${storageKey},${input.file.type},${input.file.size},${digest},${input.actorId}::uuid)
    returning id
  `);
  return { id: result.rows[0]!.id, originalName: input.file.name, contentType: input.file.type, byteSize: input.file.size };
}
