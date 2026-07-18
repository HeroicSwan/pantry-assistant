ALTER TABLE appointment_recurrence_series
  ADD COLUMN start_time time NOT NULL DEFAULT '09:00',
  ADD COLUMN duration_minutes integer NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 15 AND 480),
  ADD COLUMN interval_count integer NOT NULL DEFAULT 1 CHECK(interval_count BETWEEN 1 AND 52),
  ADD COLUMN next_occurrence_date date,
  ADD COLUMN generated_through date;

UPDATE appointment_recurrence_series
SET next_occurrence_date = start_date,
    generated_through = start_date
WHERE next_occurrence_date IS NULL;

ALTER TABLE appointment_recurrence_series
  ALTER COLUMN next_occurrence_date SET NOT NULL;

ALTER TABLE sms_messages DROP CONSTRAINT sms_messages_status_check;
ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_status_check CHECK(status IN('draft','scheduled','queued','sending','accepted','sent','delivered','undelivered','failed','cancelled','excluded'));

CREATE UNIQUE INDEX appointment_recurrence_occurrence_unique
  ON appointments(recurrence_series_id, scheduled_start_at)
  WHERE recurrence_series_id IS NOT NULL;

CREATE TABLE purchase_shipment_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  pantry_location_id uuid NOT NULL,
  purchased_shipment_id uuid NOT NULL,
  inventory_item_id uuid NOT NULL,
  expected_quantity numeric(20,6) NOT NULL CHECK(expected_quantity > 0),
  expected_unit_id uuid NOT NULL,
  received_quantity numeric(20,6) NOT NULL DEFAULT 0 CHECK(received_quantity >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT purchase_lines_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT purchase_lines_shipment_scope_fk FOREIGN KEY(purchased_shipment_id,organization_id) REFERENCES purchased_shipments(id,organization_id) ON DELETE CASCADE,
  CONSTRAINT purchase_lines_item_scope_fk FOREIGN KEY(inventory_item_id,organization_id) REFERENCES inventory_items(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT purchase_lines_unit_scope_fk FOREIGN KEY(expected_unit_id,organization_id) REFERENCES units_of_measure(id,organization_id) ON DELETE RESTRICT,
  UNIQUE(purchased_shipment_id, inventory_item_id)
);
CREATE INDEX purchase_lines_shipment_idx ON purchase_shipment_lines(organization_id, pantry_location_id, purchased_shipment_id);

CREATE TABLE sms_compliance_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  pantry_location_id uuid NOT NULL,
  inbound_message_id uuid NOT NULL REFERENCES inbound_messages(id) ON DELETE RESTRICT,
  to_phone_number text NOT NULL,
  from_phone_number text NOT NULL,
  body_snapshot text NOT NULL,
  command text NOT NULL,
  delivery_status text NOT NULL DEFAULT 'twiml_response',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_message_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT,
  UNIQUE(inbound_message_id)
);
CREATE INDEX sms_compliance_messages_scope_idx ON sms_compliance_messages(organization_id, pantry_location_id, created_at);

CREATE TABLE ai_rate_limit_windows (
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pantry_location_id uuid NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK(request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, organization_id, pantry_location_id, window_start),
  CONSTRAINT ai_rate_limit_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE CASCADE
);

CREATE TABLE report_export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  pantry_location_id uuid,
  report_type text NOT NULL,
  format text NOT NULL DEFAULT 'csv',
  date_from date,
  date_to date,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','processing','completed','failed')),
  row_count integer NOT NULL DEFAULT 0,
  result_text text,
  error_summary text,
  requested_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT report_job_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT
);
CREATE INDEX report_export_jobs_queue_idx ON report_export_jobs(status, created_at);

CREATE OR REPLACE FUNCTION guard_sms_compliance_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'APPEND_ONLY_RECORD' USING ERRCODE='55000'; END $$;
CREATE TRIGGER sms_compliance_messages_append_only
  BEFORE UPDATE OR DELETE ON sms_compliance_messages
  FOR EACH ROW EXECUTE FUNCTION guard_sms_compliance_append_only();
