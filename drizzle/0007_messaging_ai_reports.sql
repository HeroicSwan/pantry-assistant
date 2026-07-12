ALTER TABLE permissions DROP CONSTRAINT permissions_key_valid;
ALTER TABLE permissions ADD CONSTRAINT permissions_key_valid CHECK(key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');

CREATE TABLE sms_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  pantry_location_id uuid NOT NULL, provider text NOT NULL DEFAULT 'simulation', sending_mode text NOT NULL DEFAULT 'simulation',
  messaging_service_sid_reference text, default_from_number text, default_language text NOT NULL DEFAULT 'en', quiet_hours_start time, quiet_hours_end time,
  reminder_hours_before integer NOT NULL DEFAULT 24 CHECK(reminder_hours_before BETWEEN 1 AND 168), retry_limit integer NOT NULL DEFAULT 3 CHECK(retry_limit BETWEEN 0 AND 10),
  simulation_recipient text, help_response text NOT NULL DEFAULT 'Reply STOP to opt out. Contact the pantry for assistance.', is_enabled boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_settings_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT sms_settings_mode_check CHECK(sending_mode IN('disabled','simulation','twilio_test','live')), UNIQUE(organization_id,pantry_location_id)
);
CREATE TABLE message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, pantry_location_id uuid,
  name text NOT NULL, template_type text NOT NULL, language text NOT NULL DEFAULT 'en', body text NOT NULL, status text NOT NULL DEFAULT 'active',
  variables jsonb NOT NULL DEFAULT '[]'::jsonb, is_system_template boolean NOT NULL DEFAULT false, created_by uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CONSTRAINT message_templates_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT,
  UNIQUE(organization_id,pantry_location_id,name,language)
);
CREATE TABLE message_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, pantry_location_id uuid NOT NULL,
  name text NOT NULL, campaign_type text NOT NULL, status text NOT NULL DEFAULT 'draft', template_id uuid REFERENCES message_templates(id) ON DELETE RESTRICT,
  audience_definition jsonb NOT NULL DEFAULT '{}'::jsonb, message_body_snapshot text NOT NULL, scheduled_for timestamptz, approved_by uuid REFERENCES "user"(id), approved_at timestamptz,
  cancelled_by uuid REFERENCES "user"(id), cancelled_at timestamptz, cancellation_reason text, created_by uuid NOT NULL REFERENCES "user"(id),
  idempotency_key uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_campaign_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT message_campaign_status_check CHECK(status IN('draft','awaiting_approval','approved','scheduled','sending','partially_sent','sent','cancelled','failed')),
  UNIQUE(organization_id,idempotency_key)
);
CREATE TABLE sms_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, pantry_location_id uuid NOT NULL,
  campaign_id uuid REFERENCES message_campaigns(id) ON DELETE RESTRICT, appointment_id uuid REFERENCES appointments(id) ON DELETE RESTRICT,
  household_id uuid, household_contact_id uuid REFERENCES household_contacts(id) ON DELETE RESTRICT, consent_id uuid REFERENCES sms_consents(id) ON DELETE RESTRICT,
  direction text NOT NULL DEFAULT 'outbound', message_type text NOT NULL, status text NOT NULL DEFAULT 'draft', to_phone_number text NOT NULL, from_phone_number text,
  body_snapshot text NOT NULL, language text NOT NULL DEFAULT 'en', scheduled_for timestamptz, queued_at timestamptz, sent_at timestamptz, delivered_at timestamptz, failed_at timestamptz,
  provider text NOT NULL DEFAULT 'simulation', provider_message_id text, provider_error_code text, provider_error_message text, attempt_count integer NOT NULL DEFAULT 0,
  idempotency_key uuid NOT NULL, created_by uuid REFERENCES "user"(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sms_messages_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT sms_messages_household_scope_fk FOREIGN KEY(household_id,organization_id) REFERENCES households(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT sms_messages_status_check CHECK(status IN('draft','scheduled','queued','accepted','sending','sent','delivered','undelivered','failed','cancelled','excluded')),
  UNIQUE(organization_id,idempotency_key), UNIQUE(provider,provider_message_id)
);
CREATE INDEX sms_messages_delivery_idx ON sms_messages(organization_id,pantry_location_id,status,scheduled_for);
CREATE TABLE sms_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, pantry_location_id uuid NOT NULL, sms_message_id uuid NOT NULL REFERENCES sms_messages(id) ON DELETE RESTRICT,
  provider_event_id text NOT NULL, event_type text NOT NULL, provider_status text, payload_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, processing_status text NOT NULL DEFAULT 'processed', error_summary text, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,provider_event_id)
);
CREATE TABLE inbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, pantry_location_id uuid NOT NULL,
  household_id uuid, household_contact_id uuid REFERENCES household_contacts(id) ON DELETE RESTRICT, from_phone_number text NOT NULL, to_phone_number text NOT NULL,
  body text NOT NULL, normalized_command text, provider_message_id text NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processing_status text NOT NULL DEFAULT 'received',
  linked_appointment_id uuid REFERENCES appointments(id) ON DELETE RESTRICT, handled_by uuid REFERENCES "user"(id), handled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT,
  UNIQUE(organization_id,provider_message_id)
);
CREATE TABLE message_recipient_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL REFERENCES message_campaigns(id) ON DELETE CASCADE, household_id uuid,
  contact_id uuid REFERENCES household_contacts(id) ON DELETE RESTRICT, phone_number text, exclusion_reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, pantry_location_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT, title text NOT NULL, status text NOT NULL DEFAULT 'active', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), archived_at timestamptz,
  CONSTRAINT ai_conversation_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT
);
CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE, organization_id uuid NOT NULL,
  role text NOT NULL CHECK(role IN('user','assistant','tool','system')), content text NOT NULL, model text, token_usage jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_tool_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE RESTRICT, organization_id uuid NOT NULL, pantry_location_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES "user"(id), tool_name text NOT NULL, input_snapshot jsonb NOT NULL, output_snapshot jsonb, status text NOT NULL,
  error_code text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ai_action_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid REFERENCES ai_conversations(id) ON DELETE RESTRICT, organization_id uuid NOT NULL REFERENCES organizations(id), pantry_location_id uuid NOT NULL,
  proposed_by uuid NOT NULL REFERENCES "user"(id), action_type text NOT NULL, payload_snapshot jsonb NOT NULL, state_fingerprint text NOT NULL,
  risk_level text NOT NULL, status text NOT NULL DEFAULT 'pending', expires_at timestamptz NOT NULL, confirmed_by uuid REFERENCES "user"(id), confirmed_at timestamptz,
  executed_at timestamptz, execution_result jsonb, idempotency_key uuid NOT NULL, rejection_reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_proposal_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT,
  CONSTRAINT ai_proposal_status_check CHECK(status IN('pending','confirmed','executed','rejected','expired','stale','failed')), UNIQUE(organization_id,idempotency_key)
);

CREATE TABLE report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organizations(id), pantry_location_id uuid,
  report_type text NOT NULL, format text NOT NULL, date_from date, date_to date, filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_count integer NOT NULL DEFAULT 0, generated_by uuid NOT NULL REFERENCES "user"(id), generated_at timestamptz NOT NULL DEFAULT now(), request_id uuid NOT NULL,
  CONSTRAINT report_export_location_scope_fk FOREIGN KEY(pantry_location_id,organization_id) REFERENCES pantry_locations(id,organization_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION guard_append_only_final() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'APPEND_ONLY_RECORD' USING ERRCODE='55000'; END $$;
CREATE TRIGGER sms_events_append_only BEFORE UPDATE OR DELETE ON sms_events FOR EACH ROW EXECUTE FUNCTION guard_append_only_final();
CREATE TRIGGER inbound_messages_no_delete BEFORE DELETE ON inbound_messages FOR EACH ROW EXECUTE FUNCTION guard_append_only_final();
CREATE TRIGGER ai_tool_runs_append_only BEFORE UPDATE OR DELETE ON ai_tool_runs FOR EACH ROW EXECUTE FUNCTION guard_append_only_final();
CREATE TRIGGER report_exports_append_only BEFORE UPDATE OR DELETE ON report_exports FOR EACH ROW EXECUTE FUNCTION guard_append_only_final();
CREATE OR REPLACE FUNCTION guard_completed_sms_message() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.status IN('delivered','failed','undelivered','cancelled') AND (NEW.body_snapshot IS DISTINCT FROM OLD.body_snapshot OR NEW.to_phone_number IS DISTINCT FROM OLD.to_phone_number OR NEW.household_id IS DISTINCT FROM OLD.household_id OR NEW.consent_id IS DISTINCT FROM OLD.consent_id) THEN RAISE EXCEPTION 'SMS_MESSAGE_IMMUTABLE' USING ERRCODE='55000'; END IF; RETURN NEW; END $$;
CREATE TRIGGER sms_messages_completed_immutable BEFORE UPDATE ON sms_messages FOR EACH ROW EXECUTE FUNCTION guard_completed_sms_message();
