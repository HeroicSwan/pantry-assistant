import "server-only";

import { pool } from "@/lib/database/client";

type RecurrenceSeries = {
  id: string;
  organization_id: string;
  pantry_location_id: string;
  household_id: string;
  frequency: string;
  interval_count: number;
  start_time: string;
  duration_minutes: number;
  start_date: string;
  end_date: string | null;
  occurrence_count: number | null;
  package_template_id: string | null;
  next_occurrence_date: string;
  created_by: string;
};

function nextDate(date: Date, frequency: string, interval: number) {
  const next = new Date(date);
  if (frequency === "daily") next.setUTCDate(next.getUTCDate() + interval);
  else if (frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7 * interval);
  else if (frequency === "biweekly") next.setUTCDate(next.getUTCDate() + 14 * interval);
  else if (frequency === "monthly") next.setUTCMonth(next.getUTCMonth() + interval);
  else throw new Error(`Unsupported recurrence frequency: ${frequency}`);
  return next;
}

function appointmentNumber() {
  return `A-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

export async function generateRecurringAppointments(input: { horizonDays?: number; limit?: number } = {}) {
  const horizonDays = Math.min(Math.max(input.horizonDays ?? 90, 1), 365);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 500);
  const client = await pool.connect();
  let generated = 0;
  let seriesProcessed = 0;
  try {
    await client.query("begin");
    const rows = await client.query<RecurrenceSeries>(
      `select id, organization_id, pantry_location_id, household_id, frequency, interval_count,
              start_time::text, duration_minutes, start_date::text, end_date::text,
              occurrence_count, package_template_id, next_occurrence_date::text, created_by
         from appointment_recurrence_series
        where status='active' and next_occurrence_date <= current_date + $1::int
        order by next_occurrence_date, id
        limit $2
        for update skip locked`,
      [horizonDays, limit],
    );
    for (const series of rows.rows) {
      seriesProcessed += 1;
      const household = await client.query<{ household_size: number; preferred_language: string; status: string }>(
        `select household_size, preferred_language, status from households where id=$1 and organization_id=$2 for share`,
        [series.household_id, series.organization_id],
      );
      if (!household.rows[0] || household.rows[0].status !== "active") continue;
      let occurrenceDate = new Date(`${series.next_occurrence_date}T00:00:00.000Z`);
      const existingCount = await client.query<{ count: string }>("select count(*)::text count from appointments where recurrence_series_id=$1", [series.id]);
      let createdForSeries = Number(existingCount.rows[0]?.count ?? 0);
      const horizon = new Date();
      horizon.setUTCDate(horizon.getUTCDate() + horizonDays);
      while (occurrenceDate <= horizon) {
        if (series.end_date && occurrenceDate > new Date(`${series.end_date}T00:00:00.000Z`)) break;
        if (series.occurrence_count !== null && createdForSeries >= series.occurrence_count) break;
        const start = new Date(`${occurrenceDate.toISOString().slice(0, 10)}T${series.start_time}Z`);
        const end = new Date(start.getTime() + series.duration_minutes * 60_000);
        const inserted = await client.query<{ id: string }>(
          `insert into appointments(
             organization_id, pantry_location_id, household_id, appointment_number,
             appointment_type, status, scheduled_start_at, scheduled_end_at,
             package_template_id, household_size_snapshot, preferred_language_snapshot,
             recurrence_series_id, created_by
           ) values($1,$2,$3,$4,'recurring_pickup','scheduled',$5,$6,$7,$8,$9,$10,$11)
           on conflict (recurrence_series_id, scheduled_start_at) where recurrence_series_id is not null do nothing
           returning id`,
          [series.organization_id, series.pantry_location_id, series.household_id, appointmentNumber(), start, end, series.package_template_id, household.rows[0].household_size, household.rows[0].preferred_language, series.id, series.created_by],
        );
        if (inserted.rows[0]) {
          generated += 1;
          createdForSeries += 1;
          await client.query(
            `insert into appointment_status_history(organization_id, pantry_location_id, appointment_id, from_status, to_status, reason, changed_by)
             values($1,$2,$3,null,'scheduled','Automatically generated from recurrence series',$4)`,
            [series.organization_id, series.pantry_location_id, inserted.rows[0].id, series.created_by],
          );
        }
        occurrenceDate = nextDate(occurrenceDate, series.frequency, series.interval_count);
      }
      await client.query(
        `update appointment_recurrence_series
            set next_occurrence_date=$2::date,
                generated_through=greatest(coalesce(generated_through,start_date),($2::date - 1)),
                updated_at=now()
          where id=$1`,
        [series.id, occurrenceDate.toISOString().slice(0, 10)],
      );
    }
    await client.query("commit");
    return { seriesProcessed, generated };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
