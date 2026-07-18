CREATE TABLE IF NOT EXISTS forecast_model_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pantry_location_id uuid NOT NULL,
  model_name text NOT NULL DEFAULT 'hybrid_seasonal_causal',
  enabled boolean NOT NULL DEFAULT false,
  seasonality jsonb NOT NULL DEFAULT '{}'::jsonb,
  causal_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
  ml_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT forecast_model_location_scope_fk FOREIGN KEY (pantry_location_id, organization_id)
    REFERENCES pantry_locations(id, organization_id) ON DELETE CASCADE,
  UNIQUE (organization_id, pantry_location_id)
);

CREATE TABLE IF NOT EXISTS forecast_causal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pantry_location_id uuid NOT NULL,
  name text NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  demand_multiplier numeric(10,4) NOT NULL DEFAULT 1 CHECK (demand_multiplier > 0),
  notes text,
  created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT causal_event_date_range CHECK (starts_on <= ends_on),
  CONSTRAINT causal_event_location_scope_fk FOREIGN KEY (pantry_location_id, organization_id)
    REFERENCES pantry_locations(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS forecast_causal_events_window_idx
  ON forecast_causal_events (organization_id, pantry_location_id, starts_on, ends_on);

CREATE TABLE IF NOT EXISTS automation_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pantry_location_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('purchase','dispose','transfer','inventory_adjustment')),
  enabled boolean NOT NULL DEFAULT false,
  autonomous boolean NOT NULL DEFAULT false,
  thresholds jsonb NOT NULL DEFAULT '{}'::jsonb,
  approval_permission text NOT NULL DEFAULT 'inventory.adjust',
  created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_policy_location_scope_fk FOREIGN KEY (pantry_location_id, organization_id)
    REFERENCES pantry_locations(id, organization_id) ON DELETE CASCADE,
  UNIQUE (organization_id, pantry_location_id, operation)
);

CREATE TABLE IF NOT EXISTS automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pantry_location_id uuid NOT NULL,
  policy_id uuid NOT NULL REFERENCES automation_policies(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','skipped')),
  actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_summary text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automation_run_location_scope_fk FOREIGN KEY (pantry_location_id, organization_id)
    REFERENCES pantry_locations(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS automation_runs_queue_idx ON automation_runs(status, created_at);

CREATE TABLE IF NOT EXISTS job_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name text NOT NULL,
  job_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed','dead_letter')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 25),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS job_queue_claim_idx ON job_queue(queue_name, status, available_at, created_at);

CREATE TABLE IF NOT EXISTS report_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  definition jsonb NOT NULL DEFAULT '{}'::jsonb,
  shared boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS file_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pantry_location_id uuid,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  original_name text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0 AND byte_size <= 52428800),
  sha256 text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attachment_location_scope_fk FOREIGN KEY (pantry_location_id, organization_id)
    REFERENCES pantry_locations(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS file_attachments_entity_idx ON file_attachments(organization_id, entity_type, entity_id, created_at);

CREATE TABLE IF NOT EXISTS eligibility_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pantry_location_id uuid NOT NULL,
  household_id uuid NOT NULL,
  program_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','verified','expired','denied','manual_review')),
  verified_at timestamptz,
  expires_at timestamptz,
  evidence_reference text,
  notes text,
  verified_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eligibility_household_scope_fk FOREIGN KEY (household_id, organization_id)
    REFERENCES households(id, organization_id) ON DELETE CASCADE,
  CONSTRAINT eligibility_location_scope_fk FOREIGN KEY (pantry_location_id, organization_id)
    REFERENCES pantry_locations(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS eligibility_household_program_idx ON eligibility_verifications(organization_id, household_id, program_code, expires_at);

CREATE TABLE IF NOT EXISTS compliance_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  country_code text NOT NULL CHECK (country_code ~ '^[A-Z]{2}$'),
  enabled boolean NOT NULL DEFAULT true,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, country_code)
);

CREATE TABLE IF NOT EXISTS ai_write_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  pantry_location_id uuid NOT NULL,
  conversation_id uuid,
  action_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','executing','completed','failed','rejected')),
  autonomous boolean NOT NULL DEFAULT false,
  result jsonb,
  error_summary text,
  created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ai_write_location_scope_fk FOREIGN KEY (pantry_location_id, organization_id)
    REFERENCES pantry_locations(id, organization_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ai_write_actions_queue_idx ON ai_write_actions(status, created_at);
