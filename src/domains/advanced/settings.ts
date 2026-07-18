import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { hasLocationPermission } from "@/lib/database/authorization";
import { DomainError } from "@/lib/errors";

export async function saveAdvancedForecastSettings(input: { actorId: string; organizationId: string; locationId: string; enabled: boolean; seasonality: Record<string, unknown>; mlParameters: Record<string, unknown> }) {
  if (!(await hasLocationPermission(db, input.actorId, input.locationId, "forecast.configure"))) throw new DomainError("FORBIDDEN");
  const result = await db.execute(sql`
    insert into forecast_model_configs(organization_id,pantry_location_id,enabled,seasonality,ml_parameters,created_by)
    values(${input.organizationId}::uuid,${input.locationId}::uuid,${input.enabled},${JSON.stringify(input.seasonality)}::jsonb,${JSON.stringify(input.mlParameters)}::jsonb,${input.actorId}::uuid)
    on conflict(organization_id,pantry_location_id) do update set enabled=excluded.enabled,seasonality=excluded.seasonality,ml_parameters=excluded.ml_parameters,updated_at=now()
    returning id,enabled,seasonality,ml_parameters
  `);
  return result.rows[0];
}

export async function saveCausalForecastEvent(input: { actorId: string; organizationId: string; locationId: string; name: string; startsOn: string; endsOn: string; demandMultiplier: number; notes?: string | null }) {
  if (!(await hasLocationPermission(db, input.actorId, input.locationId, "forecast.configure"))) throw new DomainError("FORBIDDEN");
  if (!input.name.trim() || input.startsOn > input.endsOn || !Number.isFinite(input.demandMultiplier) || input.demandMultiplier <= 0 || input.demandMultiplier > 10) throw new DomainError("VALIDATION_ERROR");
  const result = await db.execute(sql`insert into forecast_causal_events(organization_id,pantry_location_id,name,starts_on,ends_on,demand_multiplier,notes,created_by) values(${input.organizationId}::uuid,${input.locationId}::uuid,${input.name.trim()},${input.startsOn}::date,${input.endsOn}::date,${input.demandMultiplier},${input.notes ?? null},${input.actorId}::uuid) returning id,name,starts_on,ends_on,demand_multiplier`);
  return result.rows[0];
}
