CREATE TYPE "public"."audit_source" AS ENUM('application', 'database', 'seed', 'test');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."location_status" AS ENUM('active', 'temporarily_closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."operation_status" AS ENUM('started', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."organization_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."permission_risk_level" AS ENUM('low', 'moderate', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."role_scope" AS ENUM('organization', 'location');--> statement-breakpoint
CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_provider_account_unique" UNIQUE("provider_id","account_id")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid,
	"actor_user_id" uuid,
	"actor_membership_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"source" "audit_source" DEFAULT 'application' NOT NULL,
	"reason" text,
	"request_id" uuid NOT NULL,
	"previous_values" jsonb,
	"new_values" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"recipient" text NOT NULL,
	"action_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "location_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_membership_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "location_memberships_membership_location_unique" UNIQUE("organization_membership_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "membership_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"location_id" uuid,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "membership_roles_expiry_valid" CHECK ("membership_roles"."expires_at" is null or "membership_roles"."expires_at" > "membership_roles"."assigned_at")
);
--> statement-breakpoint
CREATE TABLE "operation_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"status" "operation_status" DEFAULT 'started' NOT NULL,
	"response" jsonb,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "operation_requests_actor_operation_key_unique" UNIQUE("actor_user_id","operation","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "organization_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"token_hash" text NOT NULL,
	"role_id" uuid NOT NULL,
	"location_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"invited_by" uuid NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invitations_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "organization_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"all_locations" boolean DEFAULT false NOT NULL,
	"invited_by" uuid,
	"invited_at" timestamp with time zone,
	"joined_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_memberships_org_user_unique" UNIQUE("organization_id","user_id"),
	CONSTRAINT "organization_memberships_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "organization_status" DEFAULT 'active' NOT NULL,
	"timezone" text NOT NULL,
	"default_locale" text DEFAULT 'en-US' NOT NULL,
	"phone_number" text,
	"email" text,
	"address_line_1" text,
	"address_line_2" text,
	"city" text,
	"state_region" text,
	"postal_code" text,
	"country_code" text DEFAULT 'US' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_slug_valid" CHECK ("organizations"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "organizations_country_valid" CHECK ("organizations"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "pantry_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"status" "location_status" DEFAULT 'active' NOT NULL,
	"timezone" text,
	"phone_number" text,
	"email" text,
	"address_line_1" text,
	"address_line_2" text,
	"city" text,
	"state_region" text,
	"postal_code" text,
	"country_code" text DEFAULT 'US' NOT NULL,
	"operating_notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "pantry_locations_organization_slug_unique" UNIQUE("organization_id","slug"),
	CONSTRAINT "pantry_locations_id_organization_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "pantry_locations_slug_valid" CHECK ("pantry_locations"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "pantry_locations_country_valid" CHECK ("pantry_locations"."country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"domain" text NOT NULL,
	"description" text NOT NULL,
	"risk_level" "permission_risk_level" DEFAULT 'low' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permissions_key_unique" UNIQUE("key"),
	CONSTRAINT "permissions_key_valid" CHECK ("permissions"."key" ~ '^[a-z][a-z0-9_]*[.][a-z][a-z0-9_]*$')
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"scope" "role_scope" NOT NULL,
	"is_system_role" boolean DEFAULT false NOT NULL,
	"is_editable" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "roles_system_ownership" CHECK (("roles"."is_system_role" and "roles"."organization_id" is null and not "roles"."is_editable" and "roles"."created_by" is null) or (not "roles"."is_system_role" and "roles"."organization_id" is not null and "roles"."created_by" is not null))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"first_name" text,
	"last_name" text,
	"avatar_url" text,
	"phone_number" text,
	"preferred_locale" text DEFAULT 'en-US' NOT NULL,
	"default_organization_id" uuid,
	"default_location_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_location_id_pantry_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."pantry_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_membership_id_organization_memberships_id_fk" FOREIGN KEY ("actor_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_location_scope_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_membership_scope_fk" FOREIGN KEY ("actor_membership_id","organization_id") REFERENCES "public"."organization_memberships"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_memberships" ADD CONSTRAINT "location_memberships_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_memberships" ADD CONSTRAINT "location_memberships_membership_scope_fk" FOREIGN KEY ("organization_membership_id","organization_id") REFERENCES "public"."organization_memberships"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_memberships" ADD CONSTRAINT "location_memberships_location_scope_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_organization_membership_id_organization_memberships_id_fk" FOREIGN KEY ("organization_membership_id") REFERENCES "public"."organization_memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_location_id_pantry_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."pantry_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_requests" ADD CONSTRAINT "operation_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_requests" ADD CONSTRAINT "operation_requests_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_location_id_pantry_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."pantry_locations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_location_scope_fk" FOREIGN KEY ("location_id","organization_id") REFERENCES "public"."pantry_locations"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_locations" ADD CONSTRAINT "pantry_locations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_locations" ADD CONSTRAINT "pantry_locations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_id_user_id_fk" FOREIGN KEY ("id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_organization_created_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_created_idx" ON "audit_logs" USING btree ("organization_id","action","created_at");--> statement-breakpoint
CREATE INDEX "location_memberships_location_status_idx" ON "location_memberships" USING btree ("location_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_roles_active_assignment_idx" ON "membership_roles" USING btree ("organization_membership_id","role_id",coalesce("location_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "membership_roles"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "membership_roles_membership_active_idx" ON "membership_roles" USING btree ("organization_membership_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitations_pending_email_idx" ON "organization_invitations" USING btree ("organization_id",lower("email")) WHERE "organization_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "organization_invitations_expiry_idx" ON "organization_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "organization_memberships_user_status_idx" ON "organization_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "organization_memberships_org_status_idx" ON "organization_memberships" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "organizations_status_idx" ON "organizations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pantry_locations_organization_status_idx" ON "pantry_locations" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_system_slug_idx" ON "roles" USING btree ("slug") WHERE "roles"."organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "roles_organization_slug_idx" ON "roles" USING btree ("organization_id","slug") WHERE "roles"."organization_id" is not null;--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_idx" ON "user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint

ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_default_organization_fk" FOREIGN KEY ("default_organization_id") REFERENCES "organizations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_default_location_fk" FOREIGN KEY ("default_location_id") REFERENCES "pantry_locations"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_default_scope_fk" FOREIGN KEY ("default_location_id", "default_organization_id") REFERENCES "pantry_locations"("id", "organization_id") ON DELETE set null;--> statement-breakpoint

ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_display_name_not_blank" CHECK (btrim("display_name") <> '');--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_locale_valid" CHECK ("preferred_locale" ~ '^[a-z]{2}(?:-[A-Z]{2})?$');--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_locale_valid" CHECK ("default_locale" ~ '^[a-z]{2}(?:-[A-Z]{2})?$');--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_archive_state" CHECK (("status" = 'archived' AND "archived_at" IS NOT NULL) OR ("status" <> 'archived' AND "archived_at" IS NULL));--> statement-breakpoint
ALTER TABLE "pantry_locations" ADD CONSTRAINT "pantry_locations_archive_state" CHECK (("status" = 'archived' AND "archived_at" IS NOT NULL) OR ("status" <> 'archived' AND "archived_at" IS NULL));--> statement-breakpoint
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_state_timestamps" CHECK (("status" <> 'active' OR "joined_at" IS NOT NULL) AND ("status" <> 'suspended' OR "suspended_at" IS NOT NULL) AND ("status" <> 'archived' OR "archived_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "location_memberships" ADD CONSTRAINT "location_memberships_operational_status" CHECK ("status" IN ('active', 'suspended', 'archived'));--> statement-breakpoint
ALTER TABLE "location_memberships" ADD CONSTRAINT "location_memberships_archive_state" CHECK (("status" = 'archived' AND "archived_at" IS NOT NULL) OR ("status" <> 'archived' AND "archived_at" IS NULL));--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_token_hash_valid" CHECK ("token_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_expiry_valid" CHECK ("expires_at" > "created_at");--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_acceptance_state" CHECK (("status" = 'accepted' AND "accepted_by" IS NOT NULL AND "accepted_at" IS NOT NULL) OR ("status" <> 'accepted' AND "accepted_by" IS NULL AND "accepted_at" IS NULL));--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_revocation_state" CHECK (("status" = 'revoked' AND "revoked_at" IS NOT NULL) OR ("status" <> 'revoked' AND "revoked_at" IS NULL));--> statement-breakpoint
ALTER TABLE "operation_requests" ADD CONSTRAINT "operation_requests_operation_valid" CHECK ("operation" ~ '^[a-z][a-z0-9_.]*$');--> statement-breakpoint
ALTER TABLE "operation_requests" ADD CONSTRAINT "operation_requests_hash_valid" CHECK ("request_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_valid" CHECK ("action" ~ '^[a-z][a-z0-9_.]*$');--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_entity_type_valid" CHECK ("entity_type" ~ '^[a-z][a-z0-9_]*$');--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_json_objects" CHECK (("previous_values" IS NULL OR jsonb_typeof("previous_values") = 'object') AND ("new_values" IS NULL OR jsonb_typeof("new_values") = 'object') AND jsonb_typeof("metadata") = 'object');--> statement-breakpoint

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;--> statement-breakpoint

CREATE TRIGGER user_set_updated_at BEFORE UPDATE ON "user" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER session_set_updated_at BEFORE UPDATE ON "session" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER account_set_updated_at BEFORE UPDATE ON "account" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER verification_set_updated_at BEFORE UPDATE ON "verification" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER user_profiles_set_updated_at BEFORE UPDATE ON "user_profiles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON "organizations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER pantry_locations_set_updated_at BEFORE UPDATE ON "pantry_locations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER organization_memberships_set_updated_at BEFORE UPDATE ON "organization_memberships" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER location_memberships_set_updated_at BEFORE UPDATE ON "location_memberships" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER roles_set_updated_at BEFORE UPDATE ON "roles" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint
CREATE TRIGGER organization_invitations_set_updated_at BEFORE UPDATE ON "organization_invitations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();--> statement-breakpoint

CREATE OR REPLACE FUNCTION sync_auth_user_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO user_profiles (id, email, display_name)
  VALUES (NEW.id, lower(NEW.email), NEW.name)
  ON CONFLICT (id) DO UPDATE SET email = excluded.email;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER auth_user_profile_sync AFTER INSERT OR UPDATE OF email ON "user" FOR EACH ROW EXECUTE FUNCTION sync_auth_user_profile();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_location_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_status membership_status;
BEGIN
  SELECT status INTO parent_status FROM organization_memberships WHERE id = NEW.organization_membership_id;
  IF NEW.status = 'active' AND parent_status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ACTIVE_ORGANIZATION_MEMBERSHIP_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER location_memberships_validate_parent BEFORE INSERT OR UPDATE OF organization_membership_id, status ON location_memberships FOR EACH ROW EXECUTE FUNCTION validate_location_membership();--> statement-breakpoint

CREATE OR REPLACE FUNCTION validate_membership_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  membership_org uuid;
  membership_state membership_status;
  selected_scope role_scope;
  selected_role_org uuid;
  selected_role_slug text;
  location_org uuid;
BEGIN
  SELECT organization_id, status INTO membership_org, membership_state FROM organization_memberships WHERE id = NEW.organization_membership_id;
  SELECT scope, organization_id, slug INTO selected_scope, selected_role_org, selected_role_slug FROM roles WHERE id = NEW.role_id AND archived_at IS NULL;
  IF membership_org IS NULL OR membership_state <> 'active' OR selected_scope IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_ROLE_ASSIGNMENT';
  END IF;
  IF selected_role_org IS NOT NULL AND selected_role_org <> membership_org THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CROSS_ORGANIZATION_ROLE';
  END IF;
  IF selected_scope = 'organization' AND NEW.location_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_ROLE_SCOPE';
  END IF;
  IF selected_scope = 'location' AND NEW.location_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_ROLE_SCOPE';
  END IF;
  IF selected_role_slug = 'administrator' AND NEW.expires_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ADMINISTRATOR_CANNOT_EXPIRE';
  END IF;
  IF NEW.location_id IS NOT NULL THEN
    SELECT organization_id INTO location_org FROM pantry_locations WHERE id = NEW.location_id AND status <> 'archived';
    IF location_org IS NULL OR location_org <> membership_org OR NOT EXISTS (
      SELECT 1 FROM location_memberships
      WHERE organization_membership_id = NEW.organization_membership_id
        AND location_id = NEW.location_id AND status = 'active' AND archived_at IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LOCATION_ASSIGNMENT_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER membership_roles_validate_scope BEFORE INSERT OR UPDATE OF organization_membership_id, role_id, location_id, expires_at, archived_at ON membership_roles FOR EACH ROW EXECUTE FUNCTION validate_membership_role();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_final_administrator_role_removal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_org uuid;
BEGIN
  IF OLD.role_id <> '00000000-0000-4000-8000-000000000001'::uuid OR OLD.archived_at IS NOT NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.archived_at IS NULL THEN RETURN NEW; END IF;
  SELECT organization_id INTO target_org FROM organization_memberships WHERE id = OLD.organization_membership_id;
  IF NOT EXISTS (
    SELECT 1 FROM membership_roles mr JOIN organization_memberships om ON om.id = mr.organization_membership_id
    WHERE om.organization_id = target_org AND om.status = 'active' AND om.archived_at IS NULL
      AND mr.role_id = '00000000-0000-4000-8000-000000000001'::uuid
      AND mr.location_id IS NULL AND mr.archived_at IS NULL AND mr.id <> OLD.id
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FINAL_ADMINISTRATOR'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint
CREATE TRIGGER membership_roles_preserve_final_admin BEFORE UPDATE OF archived_at OR DELETE ON membership_roles FOR EACH ROW EXECUTE FUNCTION prevent_final_administrator_role_removal();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_final_administrator_membership_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'active' AND (TG_OP = 'DELETE' OR NEW.status <> 'active') AND EXISTS (
    SELECT 1 FROM membership_roles WHERE organization_membership_id = OLD.id
      AND role_id = '00000000-0000-4000-8000-000000000001'::uuid AND archived_at IS NULL
  ) AND NOT EXISTS (
    SELECT 1 FROM organization_memberships om JOIN membership_roles mr ON mr.organization_membership_id = om.id
    WHERE om.organization_id = OLD.organization_id AND om.id <> OLD.id AND om.status = 'active' AND om.archived_at IS NULL
      AND mr.role_id = '00000000-0000-4000-8000-000000000001'::uuid AND mr.archived_at IS NULL
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FINAL_ADMINISTRATOR'; END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;--> statement-breakpoint
CREATE TRIGGER organization_memberships_preserve_final_admin BEFORE UPDATE OF status OR DELETE ON organization_memberships FOR EACH ROW EXECUTE FUNCTION prevent_final_administrator_membership_change();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_final_location_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'archived' AND NEW.status = 'archived' AND NOT EXISTS (
    SELECT 1 FROM pantry_locations WHERE organization_id = OLD.organization_id AND id <> OLD.id AND status <> 'archived'
  ) THEN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FINAL_ACTIVE_LOCATION'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER pantry_locations_preserve_final BEFORE UPDATE OF status ON pantry_locations FOR EACH ROW EXECUTE FUNCTION prevent_final_location_archive();--> statement-breakpoint

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'AUDIT_IMMUTABLE';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_logs_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();
