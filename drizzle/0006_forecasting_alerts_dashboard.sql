CREATE TYPE "forecast_scope_type" AS ENUM ('organization_default','location_default','category_override','item_override');
CREATE TYPE "forecast_confidence_level" AS ENUM ('insufficient_data','low','medium','high');
CREATE TYPE "forecast_risk_level" AS ENUM ('healthy','watch','shortage','urgent');
CREATE TYPE "forecast_job_status" AS ENUM ('queued','running','succeeded','failed');
CREATE TYPE "operational_alert_status" AS ENUM ('open','acknowledged','resolved','dismissed');
CREATE TYPE "operational_alert_severity" AS ENUM ('info','warning','critical');

CREATE TABLE "forecast_configurations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE RESTRICT,
  "pantry_location_id" uuid, "scope_type" forecast_scope_type NOT NULL, "inventory_item_id" uuid, "inventory_category_id" uuid,
  "is_active" boolean NOT NULL DEFAULT true, "lookback_7_day_weight" numeric(8,6) NOT NULL DEFAULT 0.5,
  "lookback_30_day_weight" numeric(8,6) NOT NULL DEFAULT 0.3, "lookback_90_day_weight" numeric(8,6) NOT NULL DEFAULT 0.2,
  "minimum_history_days" integer NOT NULL DEFAULT 7, "safety_stock_method" text NOT NULL DEFAULT 'days',
  "safety_stock_fixed_quantity" numeric(20,6) NOT NULL DEFAULT 0, "safety_stock_days" numeric(10,4) NOT NULL DEFAULT 2,
  "lead_time_days" integer NOT NULL DEFAULT 3, "forecast_horizon_days" integer NOT NULL DEFAULT 30,
  "shortage_warning_days" integer NOT NULL DEFAULT 7, "urgent_shortage_days" integer NOT NULL DEFAULT 3,
  "demand_spike_threshold" numeric(10,4) NOT NULL DEFAULT 1.5, "include_scheduled_demand" boolean NOT NULL DEFAULT true,
  "include_confirmed_incoming" boolean NOT NULL DEFAULT true, "include_expiration_projection" boolean NOT NULL DEFAULT true,
  "created_by" uuid NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT, "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(), "archived_at" timestamptz,
  CONSTRAINT "forecast_weights_nonnegative" CHECK (lookback_7_day_weight >= 0 AND lookback_30_day_weight >= 0 AND lookback_90_day_weight >= 0 AND lookback_7_day_weight + lookback_30_day_weight + lookback_90_day_weight > 0),
  CONSTRAINT "forecast_config_ranges" CHECK (minimum_history_days >= 0 AND safety_stock_days >= 0 AND lead_time_days >= 0 AND forecast_horizon_days BETWEEN 1 AND 365 AND urgent_shortage_days <= shortage_warning_days),
  CONSTRAINT "forecast_scope_shape" CHECK ((scope_type='organization_default' AND pantry_location_id IS NULL AND inventory_item_id IS NULL AND inventory_category_id IS NULL) OR (scope_type='location_default' AND pantry_location_id IS NOT NULL AND inventory_item_id IS NULL AND inventory_category_id IS NULL) OR (scope_type='category_override' AND pantry_location_id IS NOT NULL AND inventory_category_id IS NOT NULL AND inventory_item_id IS NULL) OR (scope_type='item_override' AND pantry_location_id IS NOT NULL AND inventory_item_id IS NOT NULL AND inventory_category_id IS NULL)),
  CONSTRAINT "forecast_config_location_scope_fk" FOREIGN KEY (pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT "forecast_config_item_scope_fk" FOREIGN KEY (inventory_item_id,organization_id) REFERENCES inventory_items(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT "forecast_config_category_scope_fk" FOREIGN KEY (inventory_category_id,organization_id) REFERENCES inventory_categories(id,organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "forecast_config_org_default_unique" ON forecast_configurations(organization_id) WHERE is_active AND archived_at IS NULL AND scope_type='organization_default';
CREATE UNIQUE INDEX "forecast_config_location_unique" ON forecast_configurations(organization_id,pantry_location_id) WHERE is_active AND archived_at IS NULL AND scope_type='location_default';
CREATE UNIQUE INDEX "forecast_config_category_unique" ON forecast_configurations(organization_id,pantry_location_id,inventory_category_id) WHERE is_active AND archived_at IS NULL AND scope_type='category_override';
CREATE UNIQUE INDEX "forecast_config_item_unique" ON forecast_configurations(organization_id,pantry_location_id,inventory_item_id) WHERE is_active AND archived_at IS NULL AND scope_type='item_override';

CREATE TABLE "pantry_operating_calendars" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "pantry_location_id" uuid NOT NULL,
  "day_of_week" integer NOT NULL CHECK(day_of_week BETWEEN 0 AND 6), "is_open" boolean NOT NULL DEFAULT true,
  "opens_at" time, "closes_at" time, "effective_from" date NOT NULL, "effective_to" date,
  "created_by" uuid NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "operating_calendar_location_scope_fk" FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE CASCADE,
  CONSTRAINT "operating_calendar_dates" CHECK(effective_to IS NULL OR effective_to >= effective_from),
  UNIQUE(pantry_location_id,day_of_week,effective_from)
);
CREATE TABLE "pantry_calendar_exceptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "pantry_location_id" uuid NOT NULL,
  "date" date NOT NULL, "exception_type" text NOT NULL, "is_open" boolean NOT NULL, "opens_at" time, "closes_at" time, "reason" text NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "calendar_exception_location_scope_fk" FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE CASCADE,
  UNIQUE(pantry_location_id,date)
);
CREATE TABLE "category_item_equivalencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL, "inventory_category_id" uuid NOT NULL, "inventory_item_id" uuid NOT NULL,
  "base_quantity_per_service_unit" numeric(20,6) NOT NULL CHECK(base_quantity_per_service_unit > 0), "priority" integer NOT NULL DEFAULT 100,
  "is_active" boolean NOT NULL DEFAULT true, "created_by" uuid NOT NULL REFERENCES "user"("id") ON DELETE RESTRICT,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(), "archived_at" timestamptz,
  CONSTRAINT "equivalency_category_scope_fk" FOREIGN KEY(inventory_category_id,organization_id) REFERENCES inventory_categories(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT "equivalency_item_scope_fk" FOREIGN KEY(inventory_item_id,organization_id) REFERENCES inventory_items(id,organization_id) ON DELETE RESTRICT,
  UNIQUE(organization_id,inventory_category_id,inventory_item_id)
);

CREATE TABLE "forecast_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "pantry_location_id" uuid NOT NULL, "status" text NOT NULL DEFAULT 'completed', "calculation_version" text NOT NULL,
  "as_of" timestamptz NOT NULL, "horizon_end" date NOT NULL, "source_watermark" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "configuration_snapshot" jsonb NOT NULL, "generated_by" uuid REFERENCES "user"("id") ON DELETE RESTRICT,
  "generated_at" timestamptz NOT NULL DEFAULT now(), "job_id" uuid,
  CONSTRAINT "forecast_snapshot_location_scope_fk" FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX "forecast_snapshots_location_generated_idx" ON forecast_snapshots(organization_id,pantry_location_id,generated_at DESC);
CREATE TABLE "forecast_item_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "snapshot_id" uuid NOT NULL REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  "organization_id" uuid NOT NULL, "pantry_location_id" uuid NOT NULL, "inventory_item_id" uuid NOT NULL,
  "physical_on_hand" numeric(20,6) NOT NULL, "reserved_quantity" numeric(20,6) NOT NULL, "available_quantity" numeric(20,6) NOT NULL,
  "historical_7_quantity" numeric(20,6) NOT NULL, "historical_30_quantity" numeric(20,6) NOT NULL, "historical_90_quantity" numeric(20,6) NOT NULL,
  "weighted_daily_demand" numeric(20,6), "scheduled_demand" numeric(20,6) NOT NULL, "scheduled_reserved" numeric(20,6) NOT NULL,
  "scheduled_unreserved" numeric(20,6) NOT NULL, "confirmed_incoming" numeric(20,6) NOT NULL, "expiring_before_use" numeric(20,6) NOT NULL,
  "safety_stock" numeric(20,6) NOT NULL, "lead_time_demand" numeric(20,6) NOT NULL, "days_of_supply" numeric(20,6),
  "projected_shortage_date" date, "projected_stockout_date" date, "recommended_quantity" numeric(20,6) NOT NULL,
  "confidence_score" integer NOT NULL CHECK(confidence_score BETWEEN 0 AND 100), "confidence_level" forecast_confidence_level NOT NULL,
  "risk_level" forecast_risk_level NOT NULL, "explanation" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "forecast_item_scope_fk" FOREIGN KEY(inventory_item_id,organization_id) REFERENCES inventory_items(id,organization_id) ON DELETE RESTRICT,
  UNIQUE(snapshot_id,inventory_item_id)
);
CREATE INDEX "forecast_item_results_risk_idx" ON forecast_item_results(organization_id,pantry_location_id,risk_level);
CREATE TABLE "forecast_category_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "snapshot_id" uuid NOT NULL REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  "organization_id" uuid NOT NULL, "pantry_location_id" uuid NOT NULL, "inventory_category_id" uuid NOT NULL,
  "available_service_units" numeric(20,6) NOT NULL, "demand_service_units" numeric(20,6) NOT NULL, "coverage_days" numeric(20,6),
  "recommended_service_units" numeric(20,6) NOT NULL, "mapping_coverage_percent" numeric(8,4) NOT NULL,
  "confidence_score" integer NOT NULL, "risk_level" forecast_risk_level NOT NULL, "item_composition" jsonb NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "forecast_category_scope_fk" FOREIGN KEY(inventory_category_id,organization_id) REFERENCES inventory_categories(id,organization_id) ON DELETE RESTRICT,
  UNIQUE(snapshot_id,inventory_category_id)
);
CREATE TABLE "forecast_diagnostics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "snapshot_id" uuid NOT NULL REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  "organization_id" uuid NOT NULL, "pantry_location_id" uuid NOT NULL, "inventory_item_id" uuid, "inventory_category_id" uuid,
  "code" text NOT NULL, "severity" text NOT NULL, "message" text NOT NULL, "details" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "forecast_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "pantry_location_id" uuid NOT NULL, "job_type" text NOT NULL, "status" forecast_job_status NOT NULL DEFAULT 'queued', "deduplication_key" text NOT NULL,
  "attempt_count" integer NOT NULL DEFAULT 0, "requested_by" uuid REFERENCES "user"("id") ON DELETE RESTRICT, "requested_at" timestamptz NOT NULL DEFAULT now(),
  "started_at" timestamptz, "finished_at" timestamptz, "error_code" text, "error_message" text, "snapshot_id" uuid REFERENCES forecast_snapshots(id) ON DELETE SET NULL,
  CONSTRAINT "forecast_job_location_scope_fk" FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "forecast_jobs_active_dedupe_idx" ON forecast_jobs(organization_id,pantry_location_id,deduplication_key) WHERE status IN ('queued','running');
CREATE INDEX "forecast_jobs_queue_idx" ON forecast_jobs(status,requested_at);

CREATE TABLE "operational_alerts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "organization_id" uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "pantry_location_id" uuid NOT NULL, "alert_type" text NOT NULL, "severity" operational_alert_severity NOT NULL,
  "status" operational_alert_status NOT NULL DEFAULT 'open', "fingerprint" text NOT NULL, "title" text NOT NULL, "summary" text NOT NULL,
  "source_type" text NOT NULL, "source_id" uuid, "occurrence_count" integer NOT NULL DEFAULT 1, "first_detected_at" timestamptz NOT NULL DEFAULT now(),
  "last_detected_at" timestamptz NOT NULL DEFAULT now(), "acknowledged_at" timestamptz, "acknowledged_by" uuid,
  "resolved_at" timestamptz, "resolved_by" uuid, "dismissed_at" timestamptz, "dismissed_by" uuid, "dismissal_reason" text,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "operational_alert_location_scope_fk" FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT,
  UNIQUE(organization_id,fingerprint)
);
CREATE INDEX "operational_alerts_center_idx" ON operational_alerts(organization_id,pantry_location_id,status,severity,last_detected_at DESC);
CREATE TABLE "operational_alert_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "operational_alert_id" uuid NOT NULL REFERENCES operational_alerts(id) ON DELETE RESTRICT,
  "organization_id" uuid NOT NULL, "event_type" text NOT NULL, "from_status" operational_alert_status, "to_status" operational_alert_status,
  "reason" text, "actor_user_id" uuid REFERENCES "user"("id") ON DELETE RESTRICT, "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb, "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "operational_alert_events_alert_idx" ON operational_alert_events(operational_alert_id,created_at);
CREATE TABLE "donation_need_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "forecast_snapshot_id" uuid NOT NULL REFERENCES forecast_snapshots(id) ON DELETE RESTRICT,
  "organization_id" uuid NOT NULL, "pantry_location_id" uuid NOT NULL, "recommendations" jsonb NOT NULL,
  "generated_by" uuid REFERENCES "user"("id") ON DELETE RESTRICT, "generated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION guard_forecast_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'FORECAST_SNAPSHOT_IMMUTABLE' USING ERRCODE='55000'; END $$;
CREATE TRIGGER forecast_snapshots_immutable BEFORE UPDATE OR DELETE ON forecast_snapshots FOR EACH ROW EXECUTE FUNCTION guard_forecast_immutable();
CREATE TRIGGER forecast_item_results_immutable BEFORE UPDATE OR DELETE ON forecast_item_results FOR EACH ROW EXECUTE FUNCTION guard_forecast_immutable();
CREATE TRIGGER forecast_category_results_immutable BEFORE UPDATE OR DELETE ON forecast_category_results FOR EACH ROW EXECUTE FUNCTION guard_forecast_immutable();
CREATE TRIGGER forecast_diagnostics_immutable BEFORE UPDATE OR DELETE ON forecast_diagnostics FOR EACH ROW EXECUTE FUNCTION guard_forecast_immutable();
CREATE TRIGGER donation_need_snapshots_immutable BEFORE UPDATE OR DELETE ON donation_need_snapshots FOR EACH ROW EXECUTE FUNCTION guard_forecast_immutable();
CREATE TRIGGER operational_alert_events_immutable BEFORE UPDATE OR DELETE ON operational_alert_events FOR EACH ROW EXECUTE FUNCTION guard_forecast_immutable();
