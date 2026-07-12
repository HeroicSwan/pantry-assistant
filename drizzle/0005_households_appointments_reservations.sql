-- Prompt 5: households, appointments, inventory reservations, and pickup fulfillment.
-- Reservations are NOT ledger transactions: they reduce derived availability only.
-- Physical stock changes only when pickup completion posts pickup_fulfillment transactions.

ALTER TYPE "public"."inventory_transaction_type" ADD VALUE IF NOT EXISTS 'pickup_fulfillment';

CREATE TYPE "public"."household_status" AS ENUM('active', 'temporarily_inactive', 'suspended', 'archived', 'merged');
CREATE TYPE "public"."household_contact_type" AS ENUM('primary', 'alternate', 'emergency', 'caregiver', 'authorized_pickup');
CREATE TYPE "public"."household_preference_type" AS ENUM('dietary', 'allergen', 'accessibility', 'pickup');
CREATE TYPE "public"."sms_consent_status" AS ENUM('unknown', 'consented', 'opted_out', 'revoked', 'invalid_number');
CREATE TYPE "public"."sms_consent_source" AS ENUM('paper_form', 'verbal', 'web_form', 'inbound_start', 'imported', 'administrative_correction');
CREATE TYPE "public"."package_line_type" AS ENUM('exact_item', 'category_choice', 'optional_item');
CREATE TYPE "public"."appointment_type" AS ENUM('scheduled_pickup', 'recurring_pickup', 'walk_in', 'emergency_pickup', 'special_distribution');
CREATE TYPE "public"."appointment_status" AS ENUM('draft', 'scheduled', 'confirmed', 'arrived', 'partially_completed', 'completed', 'no_show', 'cancelled', 'rescheduled');
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'partially_fulfilled', 'fulfilled', 'released', 'expired', 'cancelled');
CREATE TYPE "public"."reservation_allocation_status" AS ENUM('active', 'released', 'fulfilled');
CREATE TYPE "public"."fulfillment_status" AS ENUM('draft', 'completed', 'partially_completed', 'corrected');

CREATE TABLE "households" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "household_number" text NOT NULL,
  "status" "household_status" DEFAULT 'active' NOT NULL,
  "display_name" text NOT NULL,
  "preferred_language" text DEFAULT 'en' NOT NULL,
  "household_size" integer DEFAULT 1 NOT NULL,
  "adult_count" integer,
  "child_count" integer,
  "senior_count" integer,
  "default_pantry_location_id" uuid,
  "operational_notes" text,
  "sensitive_notes" text,
  "external_reference" text,
  "merged_into_household_id" uuid,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "households_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "households_org_number_unique" UNIQUE("organization_id","household_number"),
  CONSTRAINT "households_display_name_not_blank" CHECK (btrim("display_name") <> ''),
  CONSTRAINT "households_size_positive" CHECK ("household_size" >= 1),
  CONSTRAINT "households_subcounts_valid" CHECK (
    COALESCE("adult_count", 0) >= 0 AND COALESCE("child_count", 0) >= 0 AND COALESCE("senior_count", 0) >= 0
    AND COALESCE("adult_count", 0) + COALESCE("child_count", 0) + COALESCE("senior_count", 0) <= "household_size"
  ),
  CONSTRAINT "households_merge_state" CHECK (("status" = 'merged') = ("merged_into_household_id" IS NOT NULL)),
  CONSTRAINT "households_archive_state" CHECK (("status" <> 'archived') OR ("archived_at" IS NOT NULL))
);

CREATE TABLE "household_contacts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "household_id" uuid NOT NULL,
  "contact_type" "household_contact_type" DEFAULT 'primary' NOT NULL,
  "name" text NOT NULL,
  "relationship_label" text,
  "phone_number" text,
  "phone_normalized" text,
  "email" text,
  "is_authorized_pickup" boolean DEFAULT false NOT NULL,
  "preferred_language" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "household_contacts_name_not_blank" CHECK (btrim("name") <> '')
);

CREATE TABLE "household_preferences" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "household_id" uuid NOT NULL,
  "preference_type" "household_preference_type" NOT NULL,
  "value_code" text NOT NULL,
  "display_label" text NOT NULL,
  "severity" text DEFAULT 'info' NOT NULL,
  "notes" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "household_preferences_severity_valid" CHECK ("severity" IN ('info', 'warning', 'critical')),
  CONSTRAINT "household_preferences_value_valid" CHECK ("value_code" ~ '^[a-z][a-z0-9_]*$')
);

CREATE TABLE "sms_consents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "household_id" uuid NOT NULL,
  "household_contact_id" uuid,
  "phone_normalized" text NOT NULL,
  "status" "sms_consent_status" DEFAULT 'unknown' NOT NULL,
  "consent_source" "sms_consent_source" NOT NULL,
  "effective_at" timestamp with time zone DEFAULT now() NOT NULL,
  "recorded_by" uuid NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "pickup_package_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid,
  "name" text NOT NULL,
  "description" text,
  "package_type" text DEFAULT 'standard' NOT NULL,
  "allow_substitutions" boolean DEFAULT true NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "pickup_package_templates_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "pickup_package_templates_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "pickup_package_templates_type_valid" CHECK ("package_type" ~ '^[a-z][a-z0-9_]*$')
);

CREATE TABLE "pickup_package_template_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "package_template_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "inventory_item_id" uuid,
  "inventory_category_id" uuid,
  "line_type" "package_line_type" DEFAULT 'exact_item' NOT NULL,
  "base_quantity" numeric(20, 6) NOT NULL,
  "is_required" boolean DEFAULT true NOT NULL,
  "allow_substitution" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "package_lines_quantity_positive" CHECK ("base_quantity" > 0),
  CONSTRAINT "package_lines_target_valid" CHECK (
    ("line_type" IN ('exact_item', 'optional_item') AND "inventory_item_id" IS NOT NULL AND "inventory_category_id" IS NULL)
    OR ("line_type" = 'category_choice' AND "inventory_category_id" IS NOT NULL AND "inventory_item_id" IS NULL)
  )
);

CREATE TABLE "household_size_package_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "package_template_id" uuid NOT NULL,
  "minimum_household_size" integer NOT NULL,
  "maximum_household_size" integer,
  "quantity_multiplier" numeric(10, 4) NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "size_rules_bounds_valid" CHECK ("minimum_household_size" >= 1 AND ("maximum_household_size" IS NULL OR "maximum_household_size" >= "minimum_household_size")),
  CONSTRAINT "size_rules_multiplier_positive" CHECK ("quantity_multiplier" > 0)
);

CREATE TABLE "appointment_recurrence_series" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "household_id" uuid NOT NULL,
  "frequency" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date,
  "occurrence_count" integer,
  "package_template_id" uuid,
  "status" text DEFAULT 'active' NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "recurrence_frequency_valid" CHECK ("frequency" IN ('weekly', 'every_two_weeks', 'monthly')),
  CONSTRAINT "recurrence_bounded" CHECK ("end_date" IS NOT NULL OR "occurrence_count" IS NOT NULL),
  CONSTRAINT "recurrence_status_valid" CHECK ("status" IN ('active', 'paused', 'ended'))
);

CREATE TABLE "appointments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "household_id" uuid NOT NULL,
  "appointment_number" text NOT NULL,
  "appointment_type" "appointment_type" DEFAULT 'scheduled_pickup' NOT NULL,
  "status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
  "scheduled_start_at" timestamp with time zone NOT NULL,
  "scheduled_end_at" timestamp with time zone NOT NULL,
  "package_template_id" uuid,
  "household_size_snapshot" integer NOT NULL,
  "preferred_language_snapshot" text,
  "special_instructions" text,
  "checked_in_at" timestamp with time zone,
  "checked_in_by" uuid,
  "completed_at" timestamp with time zone,
  "completed_by" uuid,
  "cancelled_at" timestamp with time zone,
  "cancelled_by" uuid,
  "cancellation_reason" text,
  "no_show_at" timestamp with time zone,
  "no_show_by" uuid,
  "rescheduled_from_appointment_id" uuid,
  "rescheduled_to_appointment_id" uuid,
  "recurrence_series_id" uuid,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "appointments_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "appointments_id_location_unique" UNIQUE("id","pantry_location_id"),
  CONSTRAINT "appointments_id_household_unique" UNIQUE("id","household_id"),
  CONSTRAINT "appointments_org_number_unique" UNIQUE("organization_id","appointment_number"),
  CONSTRAINT "appointments_window_valid" CHECK ("scheduled_start_at" < "scheduled_end_at"),
  CONSTRAINT "appointments_size_snapshot_positive" CHECK ("household_size_snapshot" >= 1)
);

CREATE TABLE "appointment_status_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "appointment_id" uuid NOT NULL,
  "from_status" "appointment_status",
  "to_status" "appointment_status" NOT NULL,
  "reason" text,
  "changed_by" uuid NOT NULL,
  "changed_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "appointment_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "appointment_id" uuid NOT NULL,
  "package_template_id" uuid,
  "template_snapshot" jsonb NOT NULL,
  "household_size_snapshot" integer NOT NULL,
  "size_multiplier_snapshot" numeric(10, 4) NOT NULL,
  "override_reason" text,
  "generated_by" uuid NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "appointment_allocations_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "appointment_allocations_appointment_unique" UNIQUE("appointment_id")
);

CREATE TABLE "appointment_allocation_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "appointment_allocation_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "inventory_item_id" uuid,
  "inventory_category_id" uuid,
  "line_type" "package_line_type" NOT NULL,
  "requested_base_quantity" numeric(20, 6) NOT NULL,
  "is_required" boolean DEFAULT true NOT NULL,
  "allow_substitution" boolean DEFAULT true NOT NULL,
  "priority" integer DEFAULT 100 NOT NULL,
  "source_template_line_id" uuid,
  "override_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "allocation_lines_id_item_unique" UNIQUE("id","inventory_item_id"),
  CONSTRAINT "allocation_lines_quantity_positive" CHECK ("requested_base_quantity" > 0),
  CONSTRAINT "allocation_lines_target_valid" CHECK (
    ("line_type" IN ('exact_item', 'optional_item') AND "inventory_item_id" IS NOT NULL AND "inventory_category_id" IS NULL)
    OR ("line_type" = 'category_choice' AND "inventory_category_id" IS NOT NULL)
  )
);

CREATE TABLE "inventory_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "appointment_id" uuid NOT NULL,
  "household_id" uuid NOT NULL,
  "status" "reservation_status" DEFAULT 'active' NOT NULL,
  "reserved_by" uuid NOT NULL,
  "reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone,
  "released_at" timestamp with time zone,
  "released_by" uuid,
  "release_reason" text,
  "fulfilled_at" timestamp with time zone,
  "idempotency_key" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_reservations_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "inventory_reservations_id_appointment_unique" UNIQUE("id","appointment_id"),
  CONSTRAINT "inventory_reservations_idempotency_unique" UNIQUE("organization_id","idempotency_key")
);

CREATE TABLE "inventory_reservation_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reservation_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "appointment_allocation_line_id" uuid,
  "inventory_item_id" uuid NOT NULL,
  "requested_base_quantity" numeric(20, 6) NOT NULL,
  "reserved_base_quantity" numeric(20, 6) DEFAULT 0 NOT NULL,
  "fulfilled_base_quantity" numeric(20, 6) DEFAULT 0 NOT NULL,
  "released_base_quantity" numeric(20, 6) DEFAULT 0 NOT NULL,
  "is_required" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "reservation_lines_id_item_unique" UNIQUE("id","inventory_item_id"),
  CONSTRAINT "reservation_lines_quantities_valid" CHECK (
    "requested_base_quantity" > 0 AND "reserved_base_quantity" >= 0
    AND "fulfilled_base_quantity" >= 0 AND "released_base_quantity" >= 0
    AND "fulfilled_base_quantity" + "released_base_quantity" <= "reserved_base_quantity"
  )
);

CREATE TABLE "inventory_reservation_lot_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "reservation_line_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "inventory_lot_id" uuid NOT NULL,
  "reserved_base_quantity" numeric(20, 6) NOT NULL,
  "fulfilled_base_quantity" numeric(20, 6) DEFAULT 0 NOT NULL,
  "released_base_quantity" numeric(20, 6) DEFAULT 0 NOT NULL,
  "status" "reservation_allocation_status" DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "lot_allocations_quantities_valid" CHECK (
    "reserved_base_quantity" > 0 AND "fulfilled_base_quantity" >= 0 AND "released_base_quantity" >= 0
    AND "fulfilled_base_quantity" + "released_base_quantity" <= "reserved_base_quantity"
  )
);

CREATE TABLE "pickup_fulfillments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "appointment_id" uuid NOT NULL,
  "household_id" uuid NOT NULL,
  "reservation_id" uuid,
  "status" "fulfillment_status" DEFAULT 'draft' NOT NULL,
  "completed_by" uuid,
  "completed_at" timestamp with time zone,
  "correction_of_fulfillment_id" uuid,
  "correction_reason" text,
  "idempotency_key" uuid NOT NULL,
  "notes" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pickup_fulfillments_idempotency_unique" UNIQUE("organization_id","idempotency_key")
);

CREATE TABLE "pickup_fulfillment_lines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "pickup_fulfillment_id" uuid NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "reservation_line_id" uuid,
  "inventory_item_id" uuid NOT NULL,
  "inventory_lot_id" uuid NOT NULL,
  "fulfilled_base_quantity" numeric(20, 6) NOT NULL,
  "inventory_transaction_id" uuid,
  "unfulfilled_reason" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "fulfillment_lines_quantity_positive" CHECK ("fulfilled_base_quantity" > 0),
  CONSTRAINT "fulfillment_lines_transaction_unique" UNIQUE("inventory_transaction_id")
);

CREATE TABLE "pickup_substitutions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "appointment_id" uuid NOT NULL,
  "reservation_id" uuid NOT NULL,
  "reservation_line_id" uuid NOT NULL,
  "original_inventory_item_id" uuid NOT NULL,
  "substitute_inventory_item_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pickup_substitutions_items_differ" CHECK ("original_inventory_item_id" <> "substitute_inventory_item_id")
);

-- Foreign keys ---------------------------------------------------------------

ALTER TABLE "households" ADD CONSTRAINT "households_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict;
ALTER TABLE "households" ADD CONSTRAINT "households_default_location_scope_fk" FOREIGN KEY ("default_pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE set null;
ALTER TABLE "households" ADD CONSTRAINT "households_merged_into_scope_fk" FOREIGN KEY ("merged_into_household_id","organization_id") REFERENCES "public"."households"("id","organization_id") ON DELETE restrict;
ALTER TABLE "households" ADD CONSTRAINT "households_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "household_contacts" ADD CONSTRAINT "household_contacts_household_scope_fk" FOREIGN KEY ("household_id","organization_id") REFERENCES "public"."households"("id","organization_id") ON DELETE cascade;
ALTER TABLE "household_contacts" ADD CONSTRAINT "household_contacts_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "household_preferences" ADD CONSTRAINT "household_preferences_household_scope_fk" FOREIGN KEY ("household_id","organization_id") REFERENCES "public"."households"("id","organization_id") ON DELETE cascade;
ALTER TABLE "household_preferences" ADD CONSTRAINT "household_preferences_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_household_scope_fk" FOREIGN KEY ("household_id","organization_id") REFERENCES "public"."households"("id","organization_id") ON DELETE cascade;
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_contact_fk" FOREIGN KEY ("household_contact_id") REFERENCES "public"."household_contacts"("id") ON DELETE set null;
ALTER TABLE "sms_consents" ADD CONSTRAINT "sms_consents_recorded_by_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "pickup_package_templates" ADD CONSTRAINT "pickup_package_templates_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict;
ALTER TABLE "pickup_package_templates" ADD CONSTRAINT "pickup_package_templates_location_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE set null;
ALTER TABLE "pickup_package_templates" ADD CONSTRAINT "pickup_package_templates_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "pickup_package_template_lines" ADD CONSTRAINT "package_lines_template_scope_fk" FOREIGN KEY ("package_template_id","organization_id") REFERENCES "public"."pickup_package_templates"("id","organization_id") ON DELETE cascade;
ALTER TABLE "pickup_package_template_lines" ADD CONSTRAINT "package_lines_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict;
ALTER TABLE "pickup_package_template_lines" ADD CONSTRAINT "package_lines_category_scope_fk" FOREIGN KEY ("inventory_category_id","organization_id") REFERENCES "public"."inventory_categories"("id","organization_id") ON DELETE restrict;

ALTER TABLE "household_size_package_rules" ADD CONSTRAINT "size_rules_template_scope_fk" FOREIGN KEY ("package_template_id","organization_id") REFERENCES "public"."pickup_package_templates"("id","organization_id") ON DELETE cascade;
ALTER TABLE "household_size_package_rules" ADD CONSTRAINT "size_rules_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "appointment_recurrence_series" ADD CONSTRAINT "recurrence_household_scope_fk" FOREIGN KEY ("household_id","organization_id") REFERENCES "public"."households"("id","organization_id") ON DELETE restrict;
ALTER TABLE "appointment_recurrence_series" ADD CONSTRAINT "recurrence_location_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict;
ALTER TABLE "appointment_recurrence_series" ADD CONSTRAINT "recurrence_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_household_scope_fk" FOREIGN KEY ("household_id","organization_id") REFERENCES "public"."households"("id","organization_id") ON DELETE restrict;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_location_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_template_scope_fk" FOREIGN KEY ("package_template_id","organization_id") REFERENCES "public"."pickup_package_templates"("id","organization_id") ON DELETE set null;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_from_fk" FOREIGN KEY ("rescheduled_from_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_to_fk" FOREIGN KEY ("rescheduled_to_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_recurrence_fk" FOREIGN KEY ("recurrence_series_id") REFERENCES "public"."appointment_recurrence_series"("id") ON DELETE set null;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "appointment_status_history" ADD CONSTRAINT "status_history_appointment_scope_fk" FOREIGN KEY ("appointment_id","organization_id") REFERENCES "public"."appointments"("id","organization_id") ON DELETE cascade;
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "status_history_changed_by_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "appointment_allocations" ADD CONSTRAINT "allocations_appointment_scope_fk" FOREIGN KEY ("appointment_id","organization_id") REFERENCES "public"."appointments"("id","organization_id") ON DELETE cascade;
ALTER TABLE "appointment_allocations" ADD CONSTRAINT "allocations_location_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict;
ALTER TABLE "appointment_allocations" ADD CONSTRAINT "allocations_generated_by_fk" FOREIGN KEY ("generated_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "appointment_allocation_lines" ADD CONSTRAINT "allocation_lines_allocation_scope_fk" FOREIGN KEY ("appointment_allocation_id","organization_id") REFERENCES "public"."appointment_allocations"("id","organization_id") ON DELETE cascade;
ALTER TABLE "appointment_allocation_lines" ADD CONSTRAINT "allocation_lines_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict;
ALTER TABLE "appointment_allocation_lines" ADD CONSTRAINT "allocation_lines_category_scope_fk" FOREIGN KEY ("inventory_category_id","organization_id") REFERENCES "public"."inventory_categories"("id","organization_id") ON DELETE restrict;

ALTER TABLE "inventory_reservations" ADD CONSTRAINT "reservations_appointment_scope_fk" FOREIGN KEY ("appointment_id","organization_id") REFERENCES "public"."appointments"("id","organization_id") ON DELETE restrict;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "reservations_appointment_location_fk" FOREIGN KEY ("appointment_id","pantry_location_id") REFERENCES "public"."appointments"("id","pantry_location_id") ON DELETE restrict;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "reservations_appointment_household_fk" FOREIGN KEY ("appointment_id","household_id") REFERENCES "public"."appointments"("id","household_id") ON DELETE restrict;
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "reservations_reserved_by_fk" FOREIGN KEY ("reserved_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "inventory_reservation_lines" ADD CONSTRAINT "reservation_lines_reservation_scope_fk" FOREIGN KEY ("reservation_id","organization_id") REFERENCES "public"."inventory_reservations"("id","organization_id") ON DELETE cascade;
ALTER TABLE "inventory_reservation_lines" ADD CONSTRAINT "reservation_lines_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict;
ALTER TABLE "inventory_reservation_lines" ADD CONSTRAINT "reservation_lines_allocation_line_item_fk" FOREIGN KEY ("appointment_allocation_line_id","inventory_item_id") REFERENCES "public"."appointment_allocation_lines"("id","inventory_item_id") ON DELETE set null;

ALTER TABLE "inventory_reservation_lot_allocations" ADD CONSTRAINT "lot_allocations_line_item_fk" FOREIGN KEY ("reservation_line_id","inventory_item_id") REFERENCES "public"."inventory_reservation_lines"("id","inventory_item_id") ON DELETE cascade;
ALTER TABLE "inventory_reservation_lot_allocations" ADD CONSTRAINT "lot_allocations_lot_item_fk" FOREIGN KEY ("inventory_lot_id","inventory_item_id") REFERENCES "public"."inventory_lots"("id","inventory_item_id") ON DELETE restrict;
ALTER TABLE "inventory_reservation_lot_allocations" ADD CONSTRAINT "lot_allocations_lot_location_fk" FOREIGN KEY ("inventory_lot_id","pantry_location_id") REFERENCES "public"."inventory_lots"("id","pantry_location_id") ON DELETE restrict;

ALTER TABLE "pickup_fulfillments" ADD CONSTRAINT "fulfillments_appointment_scope_fk" FOREIGN KEY ("appointment_id","organization_id") REFERENCES "public"."appointments"("id","organization_id") ON DELETE restrict;
ALTER TABLE "pickup_fulfillments" ADD CONSTRAINT "fulfillments_appointment_household_fk" FOREIGN KEY ("appointment_id","household_id") REFERENCES "public"."appointments"("id","household_id") ON DELETE restrict;
ALTER TABLE "pickup_fulfillments" ADD CONSTRAINT "fulfillments_reservation_appointment_fk" FOREIGN KEY ("reservation_id","appointment_id") REFERENCES "public"."inventory_reservations"("id","appointment_id") ON DELETE restrict;
ALTER TABLE "pickup_fulfillments" ADD CONSTRAINT "fulfillments_correction_fk" FOREIGN KEY ("correction_of_fulfillment_id") REFERENCES "public"."pickup_fulfillments"("id") ON DELETE restrict;
ALTER TABLE "pickup_fulfillments" ADD CONSTRAINT "fulfillments_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "pickup_fulfillment_lines" ADD CONSTRAINT "fulfillment_lines_fulfillment_fk" FOREIGN KEY ("pickup_fulfillment_id") REFERENCES "public"."pickup_fulfillments"("id") ON DELETE cascade;
ALTER TABLE "pickup_fulfillment_lines" ADD CONSTRAINT "fulfillment_lines_line_item_fk" FOREIGN KEY ("reservation_line_id","inventory_item_id") REFERENCES "public"."inventory_reservation_lines"("id","inventory_item_id") ON DELETE set null;
ALTER TABLE "pickup_fulfillment_lines" ADD CONSTRAINT "fulfillment_lines_lot_item_fk" FOREIGN KEY ("inventory_lot_id","inventory_item_id") REFERENCES "public"."inventory_lots"("id","inventory_item_id") ON DELETE restrict;
ALTER TABLE "pickup_fulfillment_lines" ADD CONSTRAINT "fulfillment_lines_lot_location_fk" FOREIGN KEY ("inventory_lot_id","pantry_location_id") REFERENCES "public"."inventory_lots"("id","pantry_location_id") ON DELETE restrict;
ALTER TABLE "pickup_fulfillment_lines" ADD CONSTRAINT "fulfillment_lines_transaction_fk" FOREIGN KEY ("inventory_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict;

ALTER TABLE "pickup_substitutions" ADD CONSTRAINT "substitutions_appointment_scope_fk" FOREIGN KEY ("appointment_id","organization_id") REFERENCES "public"."appointments"("id","organization_id") ON DELETE cascade;
ALTER TABLE "pickup_substitutions" ADD CONSTRAINT "substitutions_reservation_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."inventory_reservations"("id") ON DELETE cascade;
ALTER TABLE "pickup_substitutions" ADD CONSTRAINT "substitutions_line_fk" FOREIGN KEY ("reservation_line_id") REFERENCES "public"."inventory_reservation_lines"("id") ON DELETE cascade;
ALTER TABLE "pickup_substitutions" ADD CONSTRAINT "substitutions_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

-- Indexes --------------------------------------------------------------------

CREATE INDEX "households_org_status_idx" ON "households" ("organization_id", "status");
CREATE INDEX "households_org_display_idx" ON "households" ("organization_id", lower("display_name"));
CREATE INDEX "household_contacts_household_idx" ON "household_contacts" ("household_id", "is_active");
CREATE INDEX "household_contacts_phone_idx" ON "household_contacts" ("organization_id", "phone_normalized") WHERE "phone_normalized" IS NOT NULL;
CREATE INDEX "household_preferences_household_idx" ON "household_preferences" ("household_id", "is_active");
CREATE INDEX "sms_consents_phone_idx" ON "sms_consents" ("organization_id", "phone_normalized", "effective_at");
CREATE INDEX "package_templates_org_idx" ON "pickup_package_templates" ("organization_id") WHERE "archived_at" IS NULL;
CREATE INDEX "package_lines_template_idx" ON "pickup_package_template_lines" ("package_template_id", "priority");
CREATE INDEX "size_rules_template_idx" ON "household_size_package_rules" ("package_template_id") WHERE "archived_at" IS NULL;
CREATE INDEX "appointments_org_location_start_idx" ON "appointments" ("organization_id", "pantry_location_id", "scheduled_start_at");
CREATE INDEX "appointments_household_status_idx" ON "appointments" ("household_id", "status");
CREATE INDEX "appointments_status_start_idx" ON "appointments" ("organization_id", "status", "scheduled_start_at");
CREATE INDEX "status_history_appointment_idx" ON "appointment_status_history" ("appointment_id", "changed_at");
CREATE INDEX "allocation_lines_allocation_idx" ON "appointment_allocation_lines" ("appointment_allocation_id", "priority");
CREATE UNIQUE INDEX "reservations_active_per_appointment_idx" ON "inventory_reservations" ("appointment_id") WHERE "status" IN ('active', 'partially_fulfilled');
CREATE INDEX "reservations_org_status_idx" ON "inventory_reservations" ("organization_id", "pantry_location_id", "status");
CREATE INDEX "reservations_expiry_idx" ON "inventory_reservations" ("expires_at") WHERE "status" IN ('active', 'partially_fulfilled');
CREATE INDEX "reservation_lines_reservation_idx" ON "inventory_reservation_lines" ("reservation_id");
CREATE INDEX "lot_allocations_lot_status_idx" ON "inventory_reservation_lot_allocations" ("inventory_lot_id", "status");
CREATE INDEX "lot_allocations_line_idx" ON "inventory_reservation_lot_allocations" ("reservation_line_id");
CREATE INDEX "fulfillments_appointment_idx" ON "pickup_fulfillments" ("appointment_id");
CREATE INDEX "fulfillment_lines_fulfillment_idx" ON "pickup_fulfillment_lines" ("pickup_fulfillment_id");
CREATE INDEX "fulfillment_lines_lot_idx" ON "pickup_fulfillment_lines" ("inventory_lot_id");

-- Triggers -------------------------------------------------------------------

CREATE TRIGGER households_updated_at BEFORE UPDATE ON households FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER household_contacts_updated_at BEFORE UPDATE ON household_contacts FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER household_preferences_updated_at BEFORE UPDATE ON household_preferences FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER pickup_package_templates_updated_at BEFORE UPDATE ON pickup_package_templates FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER pickup_package_template_lines_updated_at BEFORE UPDATE ON pickup_package_template_lines FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER appointment_recurrence_series_updated_at BEFORE UPDATE ON appointment_recurrence_series FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER appointments_updated_at BEFORE UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER appointment_allocations_updated_at BEFORE UPDATE ON appointment_allocations FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER appointment_allocation_lines_updated_at BEFORE UPDATE ON appointment_allocation_lines FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER inventory_reservations_updated_at BEFORE UPDATE ON inventory_reservations FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER inventory_reservation_lines_updated_at BEFORE UPDATE ON inventory_reservation_lines FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER inventory_reservation_lot_allocations_updated_at BEFORE UPDATE ON inventory_reservation_lot_allocations FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER pickup_fulfillments_updated_at BEFORE UPDATE ON pickup_fulfillments FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();

-- Status history is append-only.
CREATE TRIGGER appointment_status_history_immutable BEFORE UPDATE OR DELETE ON appointment_status_history FOR EACH ROW EXECUTE FUNCTION guard_append_only_operation_record();
-- Consent history is append-only: a new row records each change; prior rows are never edited.
CREATE TRIGGER sms_consents_immutable BEFORE UPDATE OR DELETE ON sms_consents FOR EACH ROW EXECUTE FUNCTION guard_append_only_operation_record();
CREATE TRIGGER pickup_substitutions_immutable BEFORE UPDATE OR DELETE ON pickup_substitutions FOR EACH ROW EXECUTE FUNCTION guard_append_only_operation_record();

-- Appointment state machine at the database boundary.
CREATE OR REPLACE FUNCTION guard_appointment_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  allowed := (OLD.status = 'draft' AND NEW.status IN ('scheduled','cancelled')) OR
             (OLD.status = 'scheduled' AND NEW.status IN ('confirmed','arrived','cancelled','rescheduled','no_show')) OR
             (OLD.status = 'confirmed' AND NEW.status IN ('arrived','cancelled','rescheduled','no_show')) OR
             (OLD.status = 'arrived' AND NEW.status IN ('completed','partially_completed','cancelled')) OR
             (OLD.status = 'partially_completed' AND NEW.status = 'completed') OR
             (OLD.status = 'no_show' AND NEW.status IN ('scheduled','arrived'));
  IF NOT allowed THEN RAISE EXCEPTION 'APPOINTMENT_INVALID_STATE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER appointments_transition BEFORE UPDATE OF status ON appointments FOR EACH ROW EXECUTE FUNCTION guard_appointment_transition();

-- Reservation state machine.
CREATE OR REPLACE FUNCTION guard_reservation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  allowed := (OLD.status = 'active' AND NEW.status IN ('partially_fulfilled','fulfilled','released','expired','cancelled')) OR
             (OLD.status = 'partially_fulfilled' AND NEW.status IN ('fulfilled','released','expired','cancelled'));
  IF NOT allowed THEN RAISE EXCEPTION 'RESERVATION_INVALID_STATE' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_reservations_transition BEFORE UPDATE OF status ON inventory_reservations FOR EACH ROW EXECUTE FUNCTION guard_reservation_transition();

-- Completed fulfillments are immutable except the completed -> corrected transition.
CREATE OR REPLACE FUNCTION guard_completed_fulfillment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'draft' THEN RAISE EXCEPTION 'FULFILLMENT_IMMUTABLE' USING ERRCODE = '55000'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('completed','partially_completed') THEN
    IF NEW.status = 'corrected'
       AND (to_jsonb(NEW) - 'status' - 'correction_reason' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'correction_reason' - 'updated_at') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'FULFILLMENT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'corrected' THEN RAISE EXCEPTION 'FULFILLMENT_IMMUTABLE' USING ERRCODE = '55000'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER pickup_fulfillments_guard BEFORE UPDATE OR DELETE ON pickup_fulfillments FOR EACH ROW EXECUTE FUNCTION guard_completed_fulfillment();

-- Fulfillment lines become immutable once their fulfillment leaves draft.
CREATE OR REPLACE FUNCTION guard_fulfillment_line_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status fulfillment_status;
BEGIN
  SELECT status INTO parent_status FROM pickup_fulfillments WHERE id = COALESCE(NEW.pickup_fulfillment_id, OLD.pickup_fulfillment_id);
  IF parent_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'FULFILLMENT_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER pickup_fulfillment_lines_guard BEFORE UPDATE OR DELETE ON pickup_fulfillment_lines FOR EACH ROW EXECUTE FUNCTION guard_fulfillment_line_mutation();

-- Merged or archived households cannot receive new appointments.
CREATE OR REPLACE FUNCTION guard_appointment_household() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE household_state household_status;
BEGIN
  SELECT status INTO household_state FROM households WHERE id = NEW.household_id;
  IF household_state IN ('archived','merged') THEN
    RAISE EXCEPTION 'HOUSEHOLD_NOT_ELIGIBLE' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER appointments_household_guard BEFORE INSERT ON appointments FOR EACH ROW EXECUTE FUNCTION guard_appointment_household();

-- Views ----------------------------------------------------------------------
-- Active reserved quantity per lot: reserved minus fulfilled minus released for allocations
-- belonging to unexpired active/partially fulfilled reservations.

CREATE VIEW inventory_active_reservations_by_lot AS
SELECT
  a.inventory_lot_id,
  a.organization_id,
  a.pantry_location_id,
  a.inventory_item_id,
  SUM(GREATEST(a.reserved_base_quantity - a.fulfilled_base_quantity - a.released_base_quantity, 0::numeric)) AS active_reserved_quantity
FROM inventory_reservation_lot_allocations a
JOIN inventory_reservation_lines rl ON rl.id = a.reservation_line_id
JOIN inventory_reservations r ON r.id = rl.reservation_id
WHERE a.status = 'active'
  AND r.status IN ('active', 'partially_fulfilled')
  AND (r.expires_at IS NULL OR r.expires_at > now())
GROUP BY a.inventory_lot_id, a.organization_id, a.pantry_location_id, a.inventory_item_id;

-- Rebuild balance views: available now also subtracts active reservations.
DROP VIEW inventory_item_location_balances;
DROP VIEW inventory_lot_balances;

CREATE VIEW inventory_lot_balances AS
SELECT
  l.id AS inventory_lot_id,
  l.organization_id,
  l.pantry_location_id,
  l.inventory_item_id,
  l.storage_location_id,
  l.status AS lot_status,
  l.lot_code,
  l.received_date,
  l.expiration_date,
  COALESCE(t.physical_on_hand, 0) AS physical_on_hand,
  (l.expiration_date IS NOT NULL AND l.expiration_date < (now() AT TIME ZONE COALESCE(pl.timezone, o.timezone))::date) AS is_expired,
  CASE WHEN l.expiration_date IS NOT NULL AND l.expiration_date < (now() AT TIME ZONE COALESCE(pl.timezone, o.timezone))::date THEN COALESCE(t.physical_on_hand, 0) ELSE 0 END AS expired_quantity,
  CASE WHEN l.status = 'active' AND NOT (l.expiration_date IS NOT NULL AND l.expiration_date < (now() AT TIME ZONE COALESCE(pl.timezone, o.timezone))::date) THEN COALESCE(t.physical_on_hand, 0) ELSE 0 END AS valid_on_hand,
  CASE WHEN h.has_quarantine THEN COALESCE(t.physical_on_hand, 0) ELSE 0 END AS quarantined_quantity,
  CASE WHEN h.has_recall THEN COALESCE(t.physical_on_hand, 0) ELSE 0 END AS recalled_quantity,
  COALESCE(res.active_reserved_quantity, 0) AS reserved_quantity,
  GREATEST(
    CASE WHEN l.status = 'active' AND NOT COALESCE(h.has_quarantine, false) AND NOT COALESCE(h.has_recall, false)
               AND NOT (l.expiration_date IS NOT NULL AND l.expiration_date < (now() AT TIME ZONE COALESCE(pl.timezone, o.timezone))::date)
         THEN COALESCE(t.physical_on_hand, 0) ELSE 0 END
    - COALESCE(res.active_reserved_quantity, 0),
    0::numeric
  ) AS available_quantity
FROM inventory_lots l
JOIN pantry_locations pl ON pl.id = l.pantry_location_id
JOIN organizations o ON o.id = l.organization_id
LEFT JOIN (
  SELECT inventory_lot_id, SUM(physical_delta) AS physical_on_hand
  FROM inventory_transactions GROUP BY inventory_lot_id
) t ON t.inventory_lot_id = l.id
LEFT JOIN (
  SELECT inventory_lot_id,
    bool_or(hold_type = 'quarantine') AS has_quarantine,
    bool_or(hold_type = 'recall') AS has_recall
  FROM inventory_lot_holds WHERE status = 'active' GROUP BY inventory_lot_id
) h ON h.inventory_lot_id = l.id
LEFT JOIN inventory_active_reservations_by_lot res ON res.inventory_lot_id = l.id;

CREATE VIEW inventory_item_location_balances AS
SELECT organization_id, pantry_location_id, inventory_item_id,
  SUM(physical_on_hand) AS physical_on_hand,
  SUM(expired_quantity) AS expired_quantity,
  SUM(valid_on_hand) AS valid_on_hand,
  SUM(quarantined_quantity) AS quarantined_quantity,
  SUM(recalled_quantity) AS recalled_quantity,
  SUM(reserved_quantity) AS reserved_quantity,
  SUM(available_quantity) AS available_quantity
FROM inventory_lot_balances
GROUP BY organization_id, pantry_location_id, inventory_item_id;
