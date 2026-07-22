import "server-only";

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { pool } from "@/lib/database/client";
import { getServerEnvironment } from "@/lib/env";

export const PANTRY_ASSISTANT_VERSION = "0.1.0-rc.1";

async function latestBackup() {
  try {
    const directory = join(process.cwd(), "backups");
    const files = await readdir(directory);
    const candidates = await Promise.all(
      files
        .filter((file) => file.startsWith("pantry-assistant-") && file.endsWith(".dump"))
        .map(async (file) => ({ file, modifiedAt: (await stat(join(directory, file))).mtime })),
    );
    return candidates.sort((left, right) => right.modifiedAt.getTime() - left.modifiedAt.getTime())[0] ?? null;
  } catch {
    return null;
  }
}

async function ollamaHealth(baseUrl: string, model: string) {
  try {
    const response = await fetch(new URL("/api/tags", baseUrl), { signal: AbortSignal.timeout(1_500), cache: "no-store" });
    if (!response.ok) return { status: "unavailable" as const, model };
    const payload = await response.json() as { models?: Array<{ name?: string }> };
    const installed = payload.models?.some((candidate) => candidate.name === model) ?? false;
    return { status: installed ? "ready" as const : "model_missing" as const, model };
  } catch {
    return { status: "unavailable" as const, model };
  }
}

export async function getSystemHealth() {
  const environment = getServerEnvironment();
  const [database, backup, ollama] = await Promise.all([
    pool.query("select 1"),
    latestBackup(),
    environment.ASSISTANT_PROVIDER === "ollama"
      ? ollamaHealth(environment.OLLAMA_ASSISTANT_BASE_URL, environment.OLLAMA_ASSISTANT_MODEL)
      : Promise.resolve({ status: "disabled" as const, model: null }),
  ]);
  void database;
  const backupAgeHours = backup ? Math.floor((Date.now() - backup.modifiedAt.getTime()) / 3_600_000) : null;
  return {
    version: PANTRY_ASSISTANT_VERSION,
    database: "ready" as const,
    backup: backup ? { status: backupAgeHours !== null && backupAgeHours <= 26 ? "current" as const : "overdue" as const, modifiedAt: backup.modifiedAt, ageHours: backupAgeHours } : { status: "missing" as const, modifiedAt: null, ageHours: null },
    ollama,
    lanUrl: environment.APP_URL,
  };
}
