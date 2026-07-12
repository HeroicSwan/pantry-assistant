-- Prompt 3: inventory ledger foundation (structures)
-- Native PostgreSQL. Append-only lot-level ledger; balances are derived, never stored as an editable source of truth.

CREATE TYPE "public"."unit_dimension" AS ENUM('count', 'mass', 'volume');
CREATE TYPE "public"."conversion_rounding_policy" AS ENUM('reject', 'floor', 'ceiling', 'half_up');
CREATE TYPE "public"."inventory_item_status" AS ENUM('active', 'archived');
CREATE TYPE "public"."storage_location_status" AS ENUM('active', 'archived');
CREATE TYPE "public"."lot_status" AS ENUM('active', 'depleted', 'archived');
CREATE TYPE "public"."inventory_transaction_type" AS ENUM(
  'opening_balance',
  'donation_received',
  'purchase_received',
  'transfer_in',
  'manual_positive_adjustment',
  'distribution',
  'spoilage',
  'damage',
  'expiration',
  'recall_disposal',
  'transfer_out',
  'manual_negative_adjustment',
  'reversal'
);

CREATE TABLE "units_of_measure" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "abbreviation" text NOT NULL,
  "dimension" "unit_dimension" NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "units_of_measure_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "units_of_measure_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "units_of_measure_abbreviation_not_blank" CHECK (btrim("abbreviation") <> '')
);

CREATE TABLE "inventory_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "description" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "inventory_categories_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "inventory_categories_slug_valid" CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

CREATE TABLE "inventory_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "category_id" uuid,
  "name" text NOT NULL,
  "sku" text,
  "base_unit_id" uuid NOT NULL,
  "status" "inventory_item_status" DEFAULT 'active' NOT NULL,
  "tracks_expiration" boolean DEFAULT true NOT NULL,
  "notes" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "inventory_items_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "inventory_items_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "inventory_items_archive_state" CHECK (("status" = 'archived' AND "archived_at" IS NOT NULL) OR ("status" <> 'archived' AND "archived_at" IS NULL))
);

CREATE TABLE "inventory_item_units" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "unit_id" uuid NOT NULL,
  "factor" numeric(20, 6) NOT NULL,
  "rounding_policy" "conversion_rounding_policy" DEFAULT 'reject' NOT NULL,
  "is_base_unit" boolean DEFAULT false NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_item_units_factor_positive" CHECK ("factor" > 0),
  CONSTRAINT "inventory_item_units_base_factor" CHECK (NOT "is_base_unit" OR "factor" = 1)
);

CREATE TABLE "storage_locations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "name" text NOT NULL,
  "code" text,
  "status" "storage_location_status" DEFAULT 'active' NOT NULL,
  "notes" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "storage_locations_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "storage_locations_id_pantry_unique" UNIQUE("id","pantry_location_id"),
  CONSTRAINT "storage_locations_name_not_blank" CHECK (btrim("name") <> ''),
  CONSTRAINT "storage_locations_archive_state" CHECK (("status" = 'archived' AND "archived_at" IS NOT NULL) OR ("status" <> 'archived' AND "archived_at" IS NULL))
);

CREATE TABLE "inventory_lots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "storage_location_id" uuid,
  "lot_code" text,
  "status" "lot_status" DEFAULT 'active' NOT NULL,
  "received_date" date DEFAULT now() NOT NULL,
  "best_by_date" date,
  "use_by_date" date,
  "expiration_date" date,
  "source_type" text,
  "source_reference" text,
  "notes" text,
  "created_by" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "archived_at" timestamp with time zone,
  CONSTRAINT "inventory_lots_id_org_unique" UNIQUE("id","organization_id"),
  CONSTRAINT "inventory_lots_id_pantry_unique" UNIQUE("id","pantry_location_id"),
  CONSTRAINT "inventory_lots_id_item_unique" UNIQUE("id","inventory_item_id"),
  CONSTRAINT "inventory_lots_archive_state" CHECK (("status" = 'archived' AND "archived_at" IS NOT NULL) OR ("status" <> 'archived' AND "archived_at" IS NULL))
);

CREATE TABLE "inventory_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "pantry_location_id" uuid NOT NULL,
  "inventory_item_id" uuid NOT NULL,
  "inventory_lot_id" uuid NOT NULL,
  "transaction_type" "inventory_transaction_type" NOT NULL,
  "physical_delta" numeric(20, 6) NOT NULL,
  "input_quantity" numeric(20, 6),
  "input_unit_id" uuid,
  "conversion_factor" numeric(20, 6),
  "rounding_delta" numeric(20, 6),
  "reason_code" text,
  "reason" text,
  "correlation_id" uuid,
  "reverses_transaction_id" uuid,
  "source_type" text,
  "source_reference_id" uuid,
  "source_reference" text,
  "actor_user_id" uuid NOT NULL,
  "actor_membership_id" uuid,
  "request_id" uuid NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "inventory_transactions_delta_nonzero" CHECK ("physical_delta" <> 0),
  CONSTRAINT "inventory_transactions_reversal_shape" CHECK (("transaction_type" = 'reversal') = ("reverses_transaction_id" IS NOT NULL))
);

-- Foreign keys (scope-consistent, composite where cross-scope integrity matters)
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict;
ALTER TABLE "units_of_measure" ADD CONSTRAINT "units_of_measure_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null;

ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict;
ALTER TABLE "inventory_categories" ADD CONSTRAINT "inventory_categories_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null;

ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_category_scope_fk" FOREIGN KEY ("category_id","organization_id") REFERENCES "public"."inventory_categories"("id","organization_id") ON DELETE set null;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_base_unit_scope_fk" FOREIGN KEY ("base_unit_id","organization_id") REFERENCES "public"."units_of_measure"("id","organization_id") ON DELETE restrict;
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "inventory_item_units" ADD CONSTRAINT "inventory_item_units_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict;
ALTER TABLE "inventory_item_units" ADD CONSTRAINT "inventory_item_units_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE cascade;
ALTER TABLE "inventory_item_units" ADD CONSTRAINT "inventory_item_units_unit_scope_fk" FOREIGN KEY ("unit_id","organization_id") REFERENCES "public"."units_of_measure"("id","organization_id") ON DELETE restrict;
ALTER TABLE "inventory_item_units" ADD CONSTRAINT "inventory_item_units_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null;

ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict;
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_pantry_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict;
ALTER TABLE "storage_locations" ADD CONSTRAINT "storage_locations_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_pantry_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_storage_scope_fk" FOREIGN KEY ("storage_location_id","pantry_location_id") REFERENCES "public"."storage_locations"("id","pantry_location_id") ON DELETE set null;
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict;

ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_pantry_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_lot_org_fk" FOREIGN KEY ("inventory_lot_id","organization_id") REFERENCES "public"."inventory_lots"("id","organization_id") ON DELETE restrict;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_lot_pantry_fk" FOREIGN KEY ("inventory_lot_id","pantry_location_id") REFERENCES "public"."inventory_lots"("id","pantry_location_id") ON DELETE restrict;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_lot_item_fk" FOREIGN KEY ("inventory_lot_id","inventory_item_id") REFERENCES "public"."inventory_lots"("id","inventory_item_id") ON DELETE restrict;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_input_unit_fk" FOREIGN KEY ("input_unit_id") REFERENCES "public"."units_of_measure"("id") ON DELETE restrict;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_reverses_fk" FOREIGN KEY ("reverses_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_actor_user_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict;
ALTER TABLE "inventory_transactions" ADD CONSTRAINT "inventory_transactions_actor_membership_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict;

-- Indexes and uniqueness
CREATE UNIQUE INDEX "units_of_measure_org_abbreviation_idx" ON "units_of_measure" ("organization_id", lower("abbreviation"));
CREATE UNIQUE INDEX "units_of_measure_org_name_idx" ON "units_of_measure" ("organization_id", lower("name"));
CREATE UNIQUE INDEX "inventory_categories_org_slug_idx" ON "inventory_categories" ("organization_id", "slug");
CREATE INDEX "inventory_categories_org_idx" ON "inventory_categories" ("organization_id");
CREATE UNIQUE INDEX "inventory_items_org_name_idx" ON "inventory_items" ("organization_id", lower("name"));
CREATE UNIQUE INDEX "inventory_items_org_sku_idx" ON "inventory_items" ("organization_id", lower("sku")) WHERE "sku" IS NOT NULL;
CREATE INDEX "inventory_items_org_status_idx" ON "inventory_items" ("organization_id", "status");
CREATE UNIQUE INDEX "inventory_item_units_active_idx" ON "inventory_item_units" ("inventory_item_id", "unit_id") WHERE "is_active";
CREATE UNIQUE INDEX "inventory_item_units_base_idx" ON "inventory_item_units" ("inventory_item_id") WHERE "is_base_unit" AND "is_active";
CREATE UNIQUE INDEX "storage_locations_pantry_name_idx" ON "storage_locations" ("pantry_location_id", lower("name"));
CREATE INDEX "storage_locations_pantry_status_idx" ON "storage_locations" ("pantry_location_id", "status");
CREATE INDEX "inventory_lots_item_location_idx" ON "inventory_lots" ("organization_id", "pantry_location_id", "inventory_item_id", "status");
CREATE INDEX "inventory_lots_fefo_idx" ON "inventory_lots" ("pantry_location_id", "inventory_item_id", "expiration_date", "received_date");
CREATE INDEX "inventory_lots_lot_code_idx" ON "inventory_lots" ("pantry_location_id", "inventory_item_id", lower("lot_code")) WHERE "lot_code" IS NOT NULL;
CREATE INDEX "inventory_transactions_lot_idx" ON "inventory_transactions" ("inventory_lot_id");
CREATE INDEX "inventory_transactions_location_created_idx" ON "inventory_transactions" ("organization_id", "pantry_location_id", "created_at");
CREATE INDEX "inventory_transactions_item_idx" ON "inventory_transactions" ("organization_id", "inventory_item_id");
CREATE INDEX "inventory_transactions_correlation_idx" ON "inventory_transactions" ("correlation_id") WHERE "correlation_id" IS NOT NULL;
CREATE UNIQUE INDEX "inventory_transactions_single_reversal_idx" ON "inventory_transactions" ("reverses_transaction_id") WHERE "reverses_transaction_id" IS NOT NULL;
