import { pool } from "@/lib/database/client";

export async function GET() {
  const started = performance.now();
  try {
    const result = await pool.query<{ migrations: string }>("select count(*)::text migrations from drizzle.__drizzle_migrations");
    return Response.json({ status: "ready", database: "ok", migrations: Number(result.rows[0]?.migrations ?? 0), durationMs: Math.round(performance.now() - started) });
  } catch {
    return Response.json({ status: "not_ready", database: "unavailable", durationMs: Math.round(performance.now() - started) }, { status: 503 });
  }
}
