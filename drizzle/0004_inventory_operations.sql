CREATE TYPE "public"."adjustment_risk" AS ENUM('normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."adjustment_status" AS ENUM('submitted', 'approved', 'rejected', 'posted', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."condition_event_type" AS ENUM('spoilage', 'damage', 'expiration_removal', 'recall_disposal', 'quarantine_placed', 'quarantine_released', 'recall_placed', 'recall_resolved');--> statement-breakpoint
CREATE TYPE "public"."count_status" AS ENUM('draft', 'counting', 'submitted', 'approved', 'reconciled', 'cancelled', 'stale');--> statement-breakpoint
CREATE TYPE "public"."donation_status" AS ENUM('draft', 'expected', 'receiving', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."donor_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."donor_type" AS ENUM('individual', 'business', 'nonprofit', 'government', 'food_bank', 'grocery_store', 'farm', 'religious_organization', 'school', 'anonymous', 'other');--> statement-breakpoint
CREATE TYPE "public"."lot_hold_status" AS ENUM('active', 'released');--> statement-breakpoint
CREATE TYPE "public"."lot_hold_type" AS ENUM('quarantine', 'recall');--> statement-breakpoint
CREATE TYPE "public"."purchase_status" AS ENUM('draft', 'ordered', 'partially_received', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."recall_status" AS ENUM('draft', 'active', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."receiving_line_status" AS ENUM('draft', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."receiving_source_type" AS ENUM('donation', 'purchase', 'other');--> statement-breakpoint
CREATE TYPE "public"."receiving_status" AS ENUM('draft', 'in_progress', 'review', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."transfer_status" AS ENUM('draft', 'requested', 'approved', 'dispatched', 'partially_received', 'received', 'discrepancy_resolved', 'cancelled');--> statement-breakpoint
CREATE TABLE "adjustment_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pantry_location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"inventory_lot_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"entered_quantity" numeric(20, 6) NOT NULL,
	"entered_unit_id" uuid NOT NULL,
	"resolved_conversion_factor" numeric(20, 6) NOT NULL,
	"normalized_base_quantity" numeric(20, 6) NOT NULL,
	"risk" "adjustment_risk" NOT NULL,
	"status" "adjustment_status" DEFAULT 'submitted' NOT NULL,
	"reason_code" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"rejected_by" uuid,
	"decision_reason" text,
	"transaction_id" uuid,
	"idempotency_key" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	CONSTRAINT "adjustment_requests_org_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "adjustment_requests_direction_valid" CHECK ("adjustment_requests"."direction" in ('positive','negative')),
	CONSTRAINT "adjustment_requests_quantities_positive" CHECK ("adjustment_requests"."entered_quantity" > 0 and "adjustment_requests"."normalized_base_quantity" > 0 and "adjustment_requests"."resolved_conversion_factor" > 0),
	CONSTRAINT "adjustment_requests_no_self_approval" CHECK ("adjustment_requests"."approved_by" is null or "adjustment_requests"."approved_by" <> "adjustment_requests"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "cycle_count_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"count_session_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"pantry_location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"inventory_lot_id" uuid NOT NULL,
	"snapshot_quantity" numeric(20, 6) NOT NULL,
	"counted_quantity" numeric(20, 6),
	"counted_unit_id" uuid,
	"normalized_counted_quantity" numeric(20, 6),
	"variance_quantity" numeric(20, 6),
	"counted_by" uuid,
	"counted_at" timestamp with time zone,
	"transaction_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_count_entries_session_lot_unique" UNIQUE("count_session_id","inventory_lot_id"),
	CONSTRAINT "cycle_count_entries_count_nonnegative" CHECK ("cycle_count_entries"."counted_quantity" is null or "cycle_count_entries"."counted_quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cycle_count_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pantry_location_id" uuid NOT NULL,
	"status" "count_status" DEFAULT 'draft' NOT NULL,
	"started_by" uuid NOT NULL,
	"submitted_by" uuid,
	"approved_by" uuid,
	"snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"idempotency_key" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cycle_count_sessions_org_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "cycle_count_sessions_no_self_approval" CHECK ("cycle_count_sessions"."approved_by" is null or "cycle_count_sessions"."approved_by" <> "cycle_count_sessions"."started_by")
);
--> statement-breakpoint
CREATE TABLE "donation_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"donation_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"pantry_location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"expected_quantity" numeric(20, 6),
	"expected_unit_id" uuid,
	"received_quantity" numeric(20, 6),
	"received_unit_id" uuid,
	"estimated_value" numeric(14, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donation_lines_expected_positive" CHECK ("donation_lines"."expected_quantity" is null or "donation_lines"."expected_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pantry_location_id" uuid NOT NULL,
	"donor_id" uuid,
	"donation_number" text NOT NULL,
	"status" "donation_status" DEFAULT 'draft' NOT NULL,
	"donation_date" date DEFAULT now() NOT NULL,
	"expected_arrival_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"source_reference" text,
	"estimated_total_value" numeric(14, 2),
	"notes" text,
	"created_by" uuid NOT NULL,
	"completed_by" uuid,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "donations_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "donations_id_location_unique" UNIQUE("id","pantry_location_id"),
	CONSTRAINT "donations_org_number_unique" UNIQUE("organization_id","donation_number")
);
--> statement-breakpoint
CREATE TABLE "donors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"donor_type" "donor_type" NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone_number" text,
	"address_line_1" text,
	"address_line_2" text,
	"city" text,
	"state_region" text,
	"postal_code" text,
	"country_code" text DEFAULT 'US' NOT NULL,
	"external_reference" text,
	"notes" text,
	"is_anonymous_placeholder" boolean DEFAULT false NOT NULL,
	"status" "donor_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "donors_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "donors_name_not_blank" CHECK (btrim("donors"."name") <> ''),
	CONSTRAINT "donors_archive_state" CHECK (("donors"."status" = 'archived' and "donors"."archived_at" is not null) or ("donors"."status" = 'active' and "donors"."archived_at" is null))
);
--> statement-breakpoint
CREATE TABLE "inventory_condition_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pantry_location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"inventory_lot_id" uuid NOT NULL,
	"event_type" "condition_event_type" NOT NULL,
	"entered_quantity" numeric(20, 6),
	"entered_unit_id" uuid,
	"normalized_base_quantity" numeric(20, 6),
	"transaction_id" uuid,
	"recall_id" uuid,
	"reason" text NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_condition_events_org_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "inventory_condition_events_quantity_shape" CHECK (("inventory_condition_events"."event_type" in ('spoilage','damage','expiration_removal','recall_disposal') and "inventory_condition_events"."entered_quantity" > 0 and "inventory_condition_events"."entered_unit_id" is not null and "inventory_condition_events"."normalized_base_quantity" > 0 and "inventory_condition_events"."transaction_id" is not null) or ("inventory_condition_events"."event_type" in ('quarantine_placed','quarantine_released','recall_placed','recall_resolved') and "inventory_condition_events"."entered_quantity" is null and "inventory_condition_events"."entered_unit_id" is null and "inventory_condition_events"."normalized_base_quantity" is null and "inventory_condition_events"."transaction_id" is null))
);
--> statement-breakpoint
CREATE TABLE "inventory_lot_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pantry_location_id" uuid NOT NULL,
	"inventory_lot_id" uuid NOT NULL,
	"hold_type" "lot_hold_type" NOT NULL,
	"status" "lot_hold_status" DEFAULT 'active' NOT NULL,
	"condition_event_id" uuid NOT NULL,
	"recall_id" uuid,
	"placed_by" uuid NOT NULL,
	"released_by" uuid,
	"reason" text NOT NULL,
	"resolution" text,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventory_recall_lots" (
	"recall_id" uuid NOT NULL,
	"inventory_lot_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_recall_lots_recall_id_inventory_lot_id_pk" PRIMARY KEY("recall_id","inventory_lot_id")
);
--> statement-breakpoint
CREATE TABLE "inventory_recalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"reference_code" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" "recall_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"resolved_by" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "inventory_recalls_org_reference_unique" UNIQUE("organization_id","reference_code")
);
--> statement-breakpoint
CREATE TABLE "inventory_transfer_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"source_lot_id" uuid NOT NULL,
	"requested_quantity" numeric(20, 6) NOT NULL,
	"requested_unit_id" uuid NOT NULL,
	"resolved_conversion_factor" numeric(20, 6) NOT NULL,
	"requested_base_quantity" numeric(20, 6) NOT NULL,
	"dispatched_base_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"received_base_quantity" numeric(20, 6) DEFAULT '0' NOT NULL,
	"transfer_out_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfer_lines_transfer_lot_unique" UNIQUE("transfer_id","source_lot_id"),
	CONSTRAINT "inventory_transfer_lines_quantities_valid" CHECK ("inventory_transfer_lines"."requested_quantity" > 0 and "inventory_transfer_lines"."requested_base_quantity" > 0 and "inventory_transfer_lines"."dispatched_base_quantity" >= 0 and "inventory_transfer_lines"."dispatched_base_quantity" <= "inventory_transfer_lines"."requested_base_quantity" and "inventory_transfer_lines"."received_base_quantity" >= 0 and "inventory_transfer_lines"."received_base_quantity" <= "inventory_transfer_lines"."dispatched_base_quantity")
);
--> statement-breakpoint
CREATE TABLE "inventory_transfer_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transfer_id" uuid NOT NULL,
	"transfer_line_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"destination_location_id" uuid NOT NULL,
	"destination_lot_id" uuid NOT NULL,
	"received_base_quantity" numeric(20, 6) NOT NULL,
	"transfer_in_transaction_id" uuid NOT NULL,
	"received_by" uuid NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"discrepancy_reason" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfer_receipts_transfer_idempotency_unique" UNIQUE("transfer_id","idempotency_key"),
	CONSTRAINT "inventory_transfer_receipts_quantity_positive" CHECK ("inventory_transfer_receipts"."received_base_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"transfer_number" text NOT NULL,
	"source_location_id" uuid NOT NULL,
	"destination_location_id" uuid NOT NULL,
	"status" "transfer_status" DEFAULT 'draft' NOT NULL,
	"requested_by" uuid NOT NULL,
	"approved_by" uuid,
	"dispatched_by" uuid,
	"received_by" uuid,
	"cancelled_by" uuid,
	"cancellation_reason" text,
	"discrepancy_notes" text,
	"idempotency_key" uuid NOT NULL,
	"notes" text,
	"requested_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_transfers_org_number_unique" UNIQUE("organization_id","transfer_number"),
	CONSTRAINT "inventory_transfers_org_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "inventory_transfers_distinct_locations" CHECK ("inventory_transfers"."source_location_id" <> "inventory_transfers"."destination_location_id"),
	CONSTRAINT "inventory_transfers_no_self_approval" CHECK ("inventory_transfers"."approved_by" is null or "inventory_transfers"."approved_by" <> "inventory_transfers"."requested_by")
);
--> statement-breakpoint
CREATE TABLE "purchased_shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pantry_location_id" uuid NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_reference" text,
	"status" "purchase_status" DEFAULT 'draft' NOT NULL,
	"ordered_at" timestamp with time zone,
	"expected_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchased_shipments_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "purchased_shipments_id_location_unique" UNIQUE("id","pantry_location_id")
);
--> statement-breakpoint
CREATE TABLE "receiving_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receiving_session_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"pantry_location_id" uuid NOT NULL,
	"inventory_item_id" uuid NOT NULL,
	"existing_lot_id" uuid,
	"created_lot_id" uuid,
	"transaction_id" uuid,
	"entered_quantity" numeric(20, 6) NOT NULL,
	"entered_unit_id" uuid NOT NULL,
	"resolved_conversion_factor" numeric(20, 6),
	"normalized_base_quantity" numeric(20, 6),
	"lot_number" text,
	"received_date" date DEFAULT now() NOT NULL,
	"best_by_date" date,
	"use_by_date" date,
	"expiration_date" date,
	"storage_location_id" uuid,
	"condition" text DEFAULT 'good' NOT NULL,
	"estimated_value" numeric(14, 2),
	"notes" text,
	"line_status" "receiving_line_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receiving_lines_quantity_positive" CHECK ("receiving_lines"."entered_quantity" > 0),
	CONSTRAINT "receiving_lines_result_shape" CHECK ("receiving_lines"."line_status" <> 'completed' or ("receiving_lines"."transaction_id" is not null and ("receiving_lines"."existing_lot_id" is not null or "receiving_lines"."created_lot_id" is not null) and "receiving_lines"."normalized_base_quantity" > 0))
);
--> statement-breakpoint
CREATE TABLE "receiving_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"pantry_location_id" uuid NOT NULL,
	"source_type" "receiving_source_type" NOT NULL,
	"donation_id" uuid,
	"purchased_shipment_id" uuid,
	"status" "receiving_status" DEFAULT 'draft' NOT NULL,
	"started_by" uuid NOT NULL,
	"completed_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"idempotency_key" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receiving_sessions_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "receiving_sessions_id_location_unique" UNIQUE("id","pantry_location_id"),
	CONSTRAINT "receiving_sessions_org_idempotency_unique" UNIQUE("organization_id","idempotency_key"),
	CONSTRAINT "receiving_sessions_source_shape" CHECK (("receiving_sessions"."source_type" = 'donation' and "receiving_sessions"."donation_id" is not null and "receiving_sessions"."purchased_shipment_id" is null) or ("receiving_sessions"."source_type" = 'purchase' and "receiving_sessions"."purchased_shipment_id" is not null and "receiving_sessions"."donation_id" is null) or ("receiving_sessions"."source_type" = 'other' and "receiving_sessions"."donation_id" is null and "receiving_sessions"."purchased_shipment_id" is null))
);
--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_rejected_by_user_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_location_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_lot_scope_fk" FOREIGN KEY ("inventory_lot_id","organization_id") REFERENCES "public"."inventory_lots"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjustment_requests" ADD CONSTRAINT "adjustment_requests_unit_scope_fk" FOREIGN KEY ("entered_unit_id","organization_id") REFERENCES "public"."units_of_measure"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_entries" ADD CONSTRAINT "cycle_count_entries_count_session_id_cycle_count_sessions_id_fk" FOREIGN KEY ("count_session_id") REFERENCES "public"."cycle_count_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_entries" ADD CONSTRAINT "cycle_count_entries_counted_by_user_id_fk" FOREIGN KEY ("counted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_entries" ADD CONSTRAINT "cycle_count_entries_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_entries" ADD CONSTRAINT "cycle_count_entries_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_entries" ADD CONSTRAINT "cycle_count_entries_lot_scope_fk" FOREIGN KEY ("inventory_lot_id","organization_id") REFERENCES "public"."inventory_lots"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_entries" ADD CONSTRAINT "cycle_count_entries_lot_location_fk" FOREIGN KEY ("inventory_lot_id","pantry_location_id") REFERENCES "public"."inventory_lots"("id","pantry_location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_sessions" ADD CONSTRAINT "cycle_count_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_sessions" ADD CONSTRAINT "cycle_count_sessions_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_sessions" ADD CONSTRAINT "cycle_count_sessions_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_sessions" ADD CONSTRAINT "cycle_count_sessions_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_count_sessions" ADD CONSTRAINT "cycle_count_sessions_location_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_lines" ADD CONSTRAINT "donation_lines_donation_org_fk" FOREIGN KEY ("donation_id","organization_id") REFERENCES "public"."donations"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_lines" ADD CONSTRAINT "donation_lines_donation_location_fk" FOREIGN KEY ("donation_id","pantry_location_id") REFERENCES "public"."donations"("id","pantry_location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_lines" ADD CONSTRAINT "donation_lines_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_lines" ADD CONSTRAINT "donation_lines_expected_unit_scope_fk" FOREIGN KEY ("expected_unit_id","organization_id") REFERENCES "public"."units_of_measure"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donation_lines" ADD CONSTRAINT "donation_lines_received_unit_scope_fk" FOREIGN KEY ("received_unit_id","organization_id") REFERENCES "public"."units_of_measure"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_location_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donations" ADD CONSTRAINT "donations_donor_scope_fk" FOREIGN KEY ("donor_id","organization_id") REFERENCES "public"."donors"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donors" ADD CONSTRAINT "donors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "donors" ADD CONSTRAINT "donors_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_condition_events" ADD CONSTRAINT "inventory_condition_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_condition_events" ADD CONSTRAINT "inventory_condition_events_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_condition_events" ADD CONSTRAINT "inventory_condition_events_recall_id_inventory_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "public"."inventory_recalls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_condition_events" ADD CONSTRAINT "inventory_condition_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_condition_events" ADD CONSTRAINT "inventory_condition_events_location_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_condition_events" ADD CONSTRAINT "inventory_condition_events_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_condition_events" ADD CONSTRAINT "inventory_condition_events_lot_scope_fk" FOREIGN KEY ("inventory_lot_id","organization_id") REFERENCES "public"."inventory_lots"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lot_holds" ADD CONSTRAINT "inventory_lot_holds_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lot_holds" ADD CONSTRAINT "inventory_lot_holds_condition_event_id_inventory_condition_events_id_fk" FOREIGN KEY ("condition_event_id") REFERENCES "public"."inventory_condition_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lot_holds" ADD CONSTRAINT "inventory_lot_holds_recall_id_inventory_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "public"."inventory_recalls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lot_holds" ADD CONSTRAINT "inventory_lot_holds_placed_by_user_id_fk" FOREIGN KEY ("placed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lot_holds" ADD CONSTRAINT "inventory_lot_holds_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lot_holds" ADD CONSTRAINT "inventory_lot_holds_lot_org_fk" FOREIGN KEY ("inventory_lot_id","organization_id") REFERENCES "public"."inventory_lots"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lot_holds" ADD CONSTRAINT "inventory_lot_holds_lot_location_fk" FOREIGN KEY ("inventory_lot_id","pantry_location_id") REFERENCES "public"."inventory_lots"("id","pantry_location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_recall_lots" ADD CONSTRAINT "inventory_recall_lots_recall_id_inventory_recalls_id_fk" FOREIGN KEY ("recall_id") REFERENCES "public"."inventory_recalls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_recall_lots" ADD CONSTRAINT "inventory_recall_lots_inventory_lot_id_inventory_lots_id_fk" FOREIGN KEY ("inventory_lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_recall_lots" ADD CONSTRAINT "inventory_recall_lots_scope_fk" FOREIGN KEY ("inventory_lot_id","organization_id") REFERENCES "public"."inventory_lots"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_recalls" ADD CONSTRAINT "inventory_recalls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_recalls" ADD CONSTRAINT "inventory_recalls_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_recalls" ADD CONSTRAINT "inventory_recalls_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_transfer_id_inventory_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."inventory_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_transfer_out_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transfer_out_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_lot_scope_fk" FOREIGN KEY ("source_lot_id","organization_id") REFERENCES "public"."inventory_lots"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_lines" ADD CONSTRAINT "inventory_transfer_lines_unit_scope_fk" FOREIGN KEY ("requested_unit_id","organization_id") REFERENCES "public"."units_of_measure"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipts" ADD CONSTRAINT "inventory_transfer_receipts_transfer_id_inventory_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."inventory_transfers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipts" ADD CONSTRAINT "inventory_transfer_receipts_transfer_line_id_inventory_transfer_lines_id_fk" FOREIGN KEY ("transfer_line_id") REFERENCES "public"."inventory_transfer_lines"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipts" ADD CONSTRAINT "inventory_transfer_receipts_transfer_in_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transfer_in_transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipts" ADD CONSTRAINT "inventory_transfer_receipts_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipts" ADD CONSTRAINT "inventory_transfer_receipts_lot_scope_fk" FOREIGN KEY ("destination_lot_id","organization_id") REFERENCES "public"."inventory_lots"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfer_receipts" ADD CONSTRAINT "inventory_transfer_receipts_lot_location_fk" FOREIGN KEY ("destination_lot_id","destination_location_id") REFERENCES "public"."inventory_lots"("id","pantry_location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_dispatched_by_user_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_received_by_user_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_source_scope_fk" FOREIGN KEY ("source_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_transfers" ADD CONSTRAINT "inventory_transfers_destination_scope_fk" FOREIGN KEY ("destination_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchased_shipments" ADD CONSTRAINT "purchased_shipments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchased_shipments" ADD CONSTRAINT "purchased_shipments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchased_shipments" ADD CONSTRAINT "purchased_shipments_location_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_transaction_id_inventory_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."inventory_transactions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_session_org_fk" FOREIGN KEY ("receiving_session_id","organization_id") REFERENCES "public"."receiving_sessions"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_session_location_fk" FOREIGN KEY ("receiving_session_id","pantry_location_id") REFERENCES "public"."receiving_sessions"("id","pantry_location_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_item_scope_fk" FOREIGN KEY ("inventory_item_id","organization_id") REFERENCES "public"."inventory_items"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_unit_scope_fk" FOREIGN KEY ("entered_unit_id","organization_id") REFERENCES "public"."units_of_measure"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_existing_lot_scope_fk" FOREIGN KEY ("existing_lot_id","organization_id") REFERENCES "public"."inventory_lots"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_created_lot_scope_fk" FOREIGN KEY ("created_lot_id","organization_id") REFERENCES "public"."inventory_lots"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_lines" ADD CONSTRAINT "receiving_lines_storage_scope_fk" FOREIGN KEY ("storage_location_id","pantry_location_id") REFERENCES "public"."storage_locations"("id","pantry_location_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_sessions" ADD CONSTRAINT "receiving_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_sessions" ADD CONSTRAINT "receiving_sessions_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_sessions" ADD CONSTRAINT "receiving_sessions_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_sessions" ADD CONSTRAINT "receiving_sessions_location_scope_fk" FOREIGN KEY ("pantry_location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_sessions" ADD CONSTRAINT "receiving_sessions_donation_scope_fk" FOREIGN KEY ("donation_id","organization_id") REFERENCES "public"."donations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receiving_sessions" ADD CONSTRAINT "receiving_sessions_purchase_scope_fk" FOREIGN KEY ("purchased_shipment_id","organization_id") REFERENCES "public"."purchased_shipments"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjustment_requests_org_location_status_idx" ON "adjustment_requests" USING btree ("organization_id","pantry_location_id","status");--> statement-breakpoint
CREATE INDEX "cycle_count_entries_session_idx" ON "cycle_count_entries" USING btree ("count_session_id");--> statement-breakpoint
CREATE INDEX "cycle_count_sessions_location_status_idx" ON "cycle_count_sessions" USING btree ("organization_id","pantry_location_id","status");--> statement-breakpoint
CREATE INDEX "donation_lines_donation_idx" ON "donation_lines" USING btree ("donation_id");--> statement-breakpoint
CREATE INDEX "donations_org_location_status_date_idx" ON "donations" USING btree ("organization_id","pantry_location_id","status","donation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "donors_org_external_reference_idx" ON "donors" USING btree ("organization_id","external_reference") WHERE "donors"."external_reference" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "donors_org_anonymous_idx" ON "donors" USING btree ("organization_id") WHERE "donors"."is_anonymous_placeholder";--> statement-breakpoint
CREATE INDEX "donors_org_status_name_idx" ON "donors" USING btree ("organization_id","status","name");--> statement-breakpoint
CREATE INDEX "inventory_condition_events_lot_created_idx" ON "inventory_condition_events" USING btree ("inventory_lot_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_lot_holds_active_type_idx" ON "inventory_lot_holds" USING btree ("inventory_lot_id","hold_type") WHERE "inventory_lot_holds"."status" = 'active';--> statement-breakpoint
CREATE INDEX "inventory_lot_holds_org_status_idx" ON "inventory_lot_holds" USING btree ("organization_id","status","hold_type");--> statement-breakpoint
CREATE INDEX "inventory_recalls_org_status_idx" ON "inventory_recalls" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "inventory_transfer_lines_transfer_idx" ON "inventory_transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE INDEX "inventory_transfer_lines_source_lot_idx" ON "inventory_transfer_lines" USING btree ("source_lot_id");--> statement-breakpoint
CREATE INDEX "inventory_transfer_receipts_line_idx" ON "inventory_transfer_receipts" USING btree ("transfer_line_id","received_at");--> statement-breakpoint
CREATE INDEX "inventory_transfers_org_status_idx" ON "inventory_transfers" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "inventory_transfers_source_status_idx" ON "inventory_transfers" USING btree ("source_location_id","status");--> statement-breakpoint
CREATE INDEX "inventory_transfers_destination_status_idx" ON "inventory_transfers" USING btree ("destination_location_id","status");--> statement-breakpoint
CREATE INDEX "purchased_shipments_org_location_status_idx" ON "purchased_shipments" USING btree ("organization_id","pantry_location_id","status");--> statement-breakpoint
CREATE INDEX "receiving_lines_session_idx" ON "receiving_lines" USING btree ("receiving_session_id");--> statement-breakpoint
CREATE INDEX "receiving_sessions_org_location_status_idx" ON "receiving_sessions" USING btree ("organization_id","pantry_location_id","status");--> statement-breakpoint

-- Prompt 4 integrity boundaries. Application services remain responsible for authorization and
-- workflow orchestration; these triggers prevent malformed or out-of-scope writes at the database edge.
CREATE OR REPLACE FUNCTION set_inventory_operation_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER donors_updated_at BEFORE UPDATE ON donors FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER donations_updated_at BEFORE UPDATE ON donations FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER donation_lines_updated_at BEFORE UPDATE ON donation_lines FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER purchased_shipments_updated_at BEFORE UPDATE ON purchased_shipments FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER receiving_sessions_updated_at BEFORE UPDATE ON receiving_sessions FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER receiving_lines_updated_at BEFORE UPDATE ON receiving_lines FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER adjustment_requests_updated_at BEFORE UPDATE ON adjustment_requests FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER inventory_recalls_updated_at BEFORE UPDATE ON inventory_recalls FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER cycle_count_sessions_updated_at BEFORE UPDATE ON cycle_count_sessions FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER cycle_count_entries_updated_at BEFORE UPDATE ON cycle_count_entries FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER inventory_transfers_updated_at BEFORE UPDATE ON inventory_transfers FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();
CREATE TRIGGER inventory_transfer_lines_updated_at BEFORE UPDATE ON inventory_transfer_lines FOR EACH ROW EXECUTE FUNCTION set_inventory_operation_updated_at();

CREATE OR REPLACE FUNCTION guard_inventory_operation_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  transfer_row inventory_transfers%ROWTYPE;
  line_row inventory_transfer_lines%ROWTYPE;
  session_row receiving_sessions%ROWTYPE;
  lot_row inventory_lots%ROWTYPE;
  count_row cycle_count_sessions%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME = 'receiving_lines' THEN
    SELECT * INTO session_row FROM receiving_sessions WHERE id = NEW.receiving_session_id;
    SELECT * INTO lot_row FROM inventory_lots WHERE id = COALESCE(NEW.existing_lot_id, NEW.created_lot_id);
    IF session_row.id IS NULL OR session_row.organization_id <> NEW.organization_id OR session_row.pantry_location_id <> NEW.pantry_location_id THEN
      RAISE EXCEPTION 'RECEIVING_SCOPE_MISMATCH' USING ERRCODE = '23514';
    END IF;
    IF lot_row.id IS NOT NULL AND (lot_row.organization_id <> NEW.organization_id OR lot_row.pantry_location_id <> NEW.pantry_location_id OR lot_row.inventory_item_id <> NEW.inventory_item_id) THEN
      RAISE EXCEPTION 'RECEIVING_LOT_SCOPE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'inventory_condition_events' THEN
    SELECT * INTO lot_row FROM inventory_lots WHERE id = NEW.inventory_lot_id;
    IF lot_row.id IS NULL OR lot_row.organization_id <> NEW.organization_id OR lot_row.pantry_location_id <> NEW.pantry_location_id OR lot_row.inventory_item_id <> NEW.inventory_item_id THEN
      RAISE EXCEPTION 'CONDITION_SCOPE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'cycle_count_entries' THEN
    SELECT * INTO count_row FROM cycle_count_sessions WHERE id = NEW.count_session_id;
    SELECT * INTO lot_row FROM inventory_lots WHERE id = NEW.inventory_lot_id;
    IF count_row.id IS NULL OR count_row.organization_id <> NEW.organization_id OR count_row.pantry_location_id <> NEW.pantry_location_id OR
       lot_row.id IS NULL OR lot_row.organization_id <> NEW.organization_id OR lot_row.pantry_location_id <> NEW.pantry_location_id OR lot_row.inventory_item_id <> NEW.inventory_item_id THEN
      RAISE EXCEPTION 'COUNT_SCOPE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'inventory_transfer_lines' THEN
    SELECT * INTO transfer_row FROM inventory_transfers WHERE id = NEW.transfer_id;
    SELECT * INTO lot_row FROM inventory_lots WHERE id = NEW.source_lot_id;
    IF transfer_row.id IS NULL OR transfer_row.organization_id <> NEW.organization_id OR
       lot_row.id IS NULL OR lot_row.organization_id <> NEW.organization_id OR lot_row.pantry_location_id <> transfer_row.source_location_id OR lot_row.inventory_item_id <> NEW.inventory_item_id THEN
      RAISE EXCEPTION 'TRANSFER_LINE_SCOPE_MISMATCH' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'inventory_transfer_receipts' THEN
    SELECT * INTO transfer_row FROM inventory_transfers WHERE id = NEW.transfer_id FOR UPDATE;
    SELECT * INTO line_row FROM inventory_transfer_lines WHERE id = NEW.transfer_line_id FOR UPDATE;
    SELECT * INTO lot_row FROM inventory_lots WHERE id = NEW.destination_lot_id;
    IF transfer_row.id IS NULL OR line_row.id IS NULL OR line_row.transfer_id <> transfer_row.id OR
       transfer_row.organization_id <> NEW.organization_id OR NEW.destination_location_id <> transfer_row.destination_location_id OR
       lot_row.id IS NULL OR lot_row.organization_id <> NEW.organization_id OR lot_row.pantry_location_id <> NEW.destination_location_id OR lot_row.inventory_item_id <> line_row.inventory_item_id THEN
      RAISE EXCEPTION 'TRANSFER_RECEIPT_SCOPE_MISMATCH' USING ERRCODE = '23514';
    END IF;
    IF COALESCE((SELECT SUM(received_base_quantity) FROM inventory_transfer_receipts WHERE transfer_line_id = NEW.transfer_line_id), 0) + NEW.received_base_quantity > line_row.dispatched_base_quantity THEN
      RAISE EXCEPTION 'TRANSFER_OVER_RECEIPT' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER receiving_lines_scope BEFORE INSERT OR UPDATE ON receiving_lines FOR EACH ROW EXECUTE FUNCTION guard_inventory_operation_scope();
CREATE TRIGGER inventory_condition_events_scope BEFORE INSERT ON inventory_condition_events FOR EACH ROW EXECUTE FUNCTION guard_inventory_operation_scope();
CREATE TRIGGER cycle_count_entries_scope BEFORE INSERT OR UPDATE ON cycle_count_entries FOR EACH ROW EXECUTE FUNCTION guard_inventory_operation_scope();
CREATE TRIGGER inventory_transfer_lines_scope BEFORE INSERT OR UPDATE ON inventory_transfer_lines FOR EACH ROW EXECUTE FUNCTION guard_inventory_operation_scope();
CREATE TRIGGER inventory_transfer_receipts_scope BEFORE INSERT ON inventory_transfer_receipts FOR EACH ROW EXECUTE FUNCTION guard_inventory_operation_scope();

CREATE OR REPLACE FUNCTION guard_append_only_operation_record()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'OPERATION_RECORD_IMMUTABLE' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER inventory_condition_events_immutable BEFORE UPDATE OR DELETE ON inventory_condition_events FOR EACH ROW EXECUTE FUNCTION guard_append_only_operation_record();
CREATE TRIGGER inventory_transfer_receipts_immutable BEFORE UPDATE OR DELETE ON inventory_transfer_receipts FOR EACH ROW EXECUTE FUNCTION guard_append_only_operation_record();
CREATE TRIGGER inventory_recall_lots_immutable BEFORE UPDATE OR DELETE ON inventory_recall_lots FOR EACH ROW EXECUTE FUNCTION guard_append_only_operation_record();

CREATE OR REPLACE FUNCTION guard_completed_receiving_line()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.line_status = 'completed' THEN
    RAISE EXCEPTION 'RECEIVING_LINE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER receiving_lines_completed_immutable BEFORE UPDATE OR DELETE ON receiving_lines FOR EACH ROW EXECUTE FUNCTION guard_completed_receiving_line();

CREATE OR REPLACE FUNCTION guard_inventory_lot_hold_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'released' OR
     NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.pantry_location_id <> OLD.pantry_location_id OR
     NEW.inventory_lot_id <> OLD.inventory_lot_id OR NEW.hold_type <> OLD.hold_type OR NEW.condition_event_id <> OLD.condition_event_id OR
     NEW.placed_by <> OLD.placed_by OR NEW.placed_at <> OLD.placed_at OR NEW.reason <> OLD.reason OR NEW.recall_id IS DISTINCT FROM OLD.recall_id OR
     NOT (OLD.status = 'active' AND NEW.status = 'released' AND NEW.released_by IS NOT NULL AND NEW.released_at IS NOT NULL) THEN
    RAISE EXCEPTION 'LOT_HOLD_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_lot_holds_guard BEFORE UPDATE OR DELETE ON inventory_lot_holds FOR EACH ROW EXECUTE FUNCTION guard_inventory_lot_hold_update();

CREATE OR REPLACE FUNCTION guard_inventory_operation_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed boolean := false;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'receiving_sessions' THEN
    allowed := (OLD.status = 'draft' AND NEW.status IN ('in_progress','cancelled')) OR
               (OLD.status = 'in_progress' AND NEW.status IN ('review','completed','cancelled')) OR
               (OLD.status = 'review' AND NEW.status IN ('in_progress','completed','cancelled'));
  ELSIF TG_TABLE_NAME = 'adjustment_requests' THEN
    allowed := (OLD.status = 'submitted' AND NEW.status IN ('approved','rejected','posted','cancelled')) OR
               (OLD.status = 'approved' AND NEW.status IN ('posted','cancelled'));
  ELSIF TG_TABLE_NAME = 'cycle_count_sessions' THEN
    allowed := (OLD.status = 'draft' AND NEW.status IN ('counting','cancelled')) OR
               (OLD.status = 'counting' AND NEW.status IN ('submitted','cancelled','stale')) OR
               (OLD.status = 'submitted' AND NEW.status IN ('approved','stale','cancelled')) OR
               (OLD.status = 'approved' AND NEW.status IN ('reconciled','stale'));
  ELSIF TG_TABLE_NAME = 'inventory_transfers' THEN
    allowed := (OLD.status = 'draft' AND NEW.status IN ('requested','cancelled')) OR
               (OLD.status = 'requested' AND NEW.status IN ('approved','cancelled')) OR
               (OLD.status = 'approved' AND NEW.status IN ('dispatched','cancelled')) OR
               (OLD.status = 'dispatched' AND NEW.status IN ('partially_received','received')) OR
               (OLD.status = 'partially_received' AND NEW.status IN ('received','discrepancy_resolved')) OR
               (OLD.status = 'received' AND NEW.status = 'discrepancy_resolved');
  ELSE
    allowed := true;
  END IF;
  IF NOT allowed THEN RAISE EXCEPTION 'INVALID_OPERATION_STATE_TRANSITION' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER receiving_sessions_transition BEFORE UPDATE OF status ON receiving_sessions FOR EACH ROW EXECUTE FUNCTION guard_inventory_operation_transition();
CREATE TRIGGER adjustment_requests_transition BEFORE UPDATE OF status ON adjustment_requests FOR EACH ROW EXECUTE FUNCTION guard_inventory_operation_transition();
CREATE TRIGGER cycle_count_sessions_transition BEFORE UPDATE OF status ON cycle_count_sessions FOR EACH ROW EXECUTE FUNCTION guard_inventory_operation_transition();
CREATE TRIGGER inventory_transfers_transition BEFORE UPDATE OF status ON inventory_transfers FOR EACH ROW EXECUTE FUNCTION guard_inventory_operation_transition();

CREATE OR REPLACE FUNCTION guard_transfer_line_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE transfer_state transfer_status;
BEGIN
  SELECT status INTO transfer_state FROM inventory_transfers WHERE id = OLD.transfer_id;
  IF TG_OP = 'DELETE' AND transfer_state NOT IN ('draft','requested','approved') THEN
    RAISE EXCEPTION 'TRANSFER_LINE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND transfer_state IN ('dispatched','partially_received') AND
     (to_jsonb(NEW) - 'received_base_quantity' - 'updated_at') <> (to_jsonb(OLD) - 'received_base_quantity' - 'updated_at') THEN
    RAISE EXCEPTION 'TRANSFER_LINE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND transfer_state IN ('received','discrepancy_resolved','cancelled') THEN
    RAISE EXCEPTION 'TRANSFER_LINE_IMMUTABLE' USING ERRCODE = '55000';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER inventory_transfer_lines_mutation BEFORE UPDATE OR DELETE ON inventory_transfer_lines FOR EACH ROW EXECUTE FUNCTION guard_transfer_line_mutation();

-- Availability now excludes expired, quarantined, recalled, depleted, and archived stock.
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
  CASE WHEN l.status = 'active' AND NOT COALESCE(h.has_quarantine, false) AND NOT COALESCE(h.has_recall, false)
             AND NOT (l.expiration_date IS NOT NULL AND l.expiration_date < (now() AT TIME ZONE COALESCE(pl.timezone, o.timezone))::date)
       THEN COALESCE(t.physical_on_hand, 0) ELSE 0 END AS available_quantity
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
) h ON h.inventory_lot_id = l.id;

CREATE VIEW inventory_item_location_balances AS
SELECT organization_id, pantry_location_id, inventory_item_id,
  SUM(physical_on_hand) AS physical_on_hand,
  SUM(expired_quantity) AS expired_quantity,
  SUM(valid_on_hand) AS valid_on_hand,
  SUM(quarantined_quantity) AS quarantined_quantity,
  SUM(recalled_quantity) AS recalled_quantity,
  SUM(available_quantity) AS available_quantity
FROM inventory_lot_balances
GROUP BY organization_id, pantry_location_id, inventory_item_id;

CREATE VIEW inventory_in_transit_balances AS
SELECT t.organization_id, t.id AS transfer_id, t.source_location_id, t.destination_location_id,
  l.id AS transfer_line_id, l.inventory_item_id, l.source_lot_id,
  GREATEST(l.dispatched_base_quantity - l.received_base_quantity, 0::numeric) AS in_transit_quantity
FROM inventory_transfers t
JOIN inventory_transfer_lines l ON l.transfer_id = t.id
WHERE t.status IN ('dispatched','partially_received') AND l.dispatched_base_quantity > l.received_base_quantity;
