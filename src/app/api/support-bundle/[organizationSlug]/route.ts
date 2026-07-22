import JSZip from "jszip";
import { getCurrentUser, getOrganizationAccessList } from "@/lib/auth/access";
import { pool } from "@/lib/database/client";
import { getServerEnvironment } from "@/lib/env";
import { getSystemHealth } from "@/domains/system/health";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ organizationSlug: string }> }) {
  const { organizationSlug } = await params;
  const [user, accessList] = await Promise.all([getCurrentUser(), getOrganizationAccessList()]);
  const access = accessList.find((candidate) => candidate.organization.slug === organizationSlug);
  if (!user || !access || !access.organizationPermissions.includes("organization.update")) {
    return Response.json({ error: "Not authorized to create a support bundle." }, { status: 403 });
  }

  const [health, migrationResult] = await Promise.all([
    getSystemHealth(),
    pool.query<{ migrations: string }>("select count(*)::text migrations from drizzle.__drizzle_migrations"),
  ]);
  const environment = getServerEnvironment();
  const diagnostics = {
    generatedAt: new Date().toISOString(),
    application: { version: health.version, runtime: process.version, platform: process.platform, architecture: process.arch },
    organization: { slug: access.organization.slug, timezone: access.organization.timezone },
    database: { status: health.database, migrationCount: Number(migrationResult.rows[0]?.migrations ?? 0) },
    backup: health.backup,
    assistant: health.ollama,
    integrations: {
      smsCredentialsConfigured: Boolean(environment.TWILIO_AUTH_TOKEN || environment.VONAGE_API_SECRET || environment.PLIVO_AUTH_TOKEN || environment.TELNYX_API_KEY || environment.SINCH_API_TOKEN || environment.INFOBIP_API_KEY || environment.BANDWIDTH_API_TOKEN || environment.BIRD_ACCESS_KEY || environment.AWS_SECRET_ACCESS_KEY || environment.AZURE_COMMUNICATION_CONNECTION_STRING),
      emailConfigured: Boolean(environment.SMTP_HOST && environment.SMTP_FROM),
    },
    privacy: "This bundle contains no database records, household data, phone numbers, message bodies, passwords, API keys, or complete connection strings.",
  };
  const zip = new JSZip();
  zip.file("README.txt", "Pantry Assistant safe support bundle. It intentionally excludes household data, database contents, application logs, passwords, API keys, and connection strings. Share it only through your pantry's approved support channel.\n");
  zip.file("diagnostics.json", JSON.stringify(diagnostics, null, 2));
  const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  const filename = `pantry-assistant-support-${new Date().toISOString().slice(0, 10)}.zip`;
  const body = archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength) as ArrayBuffer;
  return new Response(body, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${filename}"`, "cache-control": "no-store" } });
}
