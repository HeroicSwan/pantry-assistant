import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const user = pgTable(
  "user",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    ...timestamps,
  },
  (table) => [uniqueIndex("user_email_lower_idx").on(sql`lower(${table.email})`)],
);

export const session = pgTable(
  "session",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [
    index("account_user_id_idx").on(table.userId),
    unique("account_provider_account_unique").on(table.providerId, table.accountId),
  ],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const membershipStatus = pgEnum("membership_status", ["invited", "active", "suspended", "archived"]);
export const organizationStatus = pgEnum("organization_status", ["active", "suspended", "archived"]);
export const locationStatus = pgEnum("location_status", ["active", "temporarily_closed", "archived"]);
export const roleScope = pgEnum("role_scope", ["organization", "location"]);
export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "revoked", "expired"]);
export const auditSource = pgEnum("audit_source", ["application", "database", "seed", "test"]);
export const permissionRiskLevel = pgEnum("permission_risk_level", ["low", "moderate", "high", "critical"]);
export const operationStatus = pgEnum("operation_status", ["started", "completed", "failed"]);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    status: organizationStatus("status").default("active").notNull(),
    timezone: text("timezone").notNull(),
    defaultLocale: text("default_locale").default("en-US").notNull(),
    phoneNumber: text("phone_number"),
    email: text("email"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    stateRegion: text("state_region"),
    postalCode: text("postal_code"),
    countryCode: text("country_code").default("US").notNull(),
    settings: jsonb("settings").default({}).notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("organizations_status_idx").on(table.status),
    check("organizations_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check("organizations_country_valid", sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
  ],
);

export const pantryLocations = pgTable(
  "pantry_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: locationStatus("status").default("active").notNull(),
    timezone: text("timezone"),
    phoneNumber: text("phone_number"),
    email: text("email"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    stateRegion: text("state_region"),
    postalCode: text("postal_code"),
    countryCode: text("country_code").default("US").notNull(),
    operatingNotes: text("operating_notes"),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("pantry_locations_organization_slug_unique").on(table.organizationId, table.slug),
    unique("pantry_locations_id_organization_unique").on(table.id, table.organizationId),
    index("pantry_locations_organization_status_idx").on(table.organizationId, table.status),
    check("pantry_locations_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
    check("pantry_locations_country_valid", sql`${table.countryCode} ~ '^[A-Z]{2}$'`),
  ],
);

export const userProfiles = pgTable(
  "user_profiles",
  {
    id: uuid("id").primaryKey().references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    avatarUrl: text("avatar_url"),
    phoneNumber: text("phone_number"),
    preferredLocale: text("preferred_locale").default("en-US").notNull(),
    defaultOrganizationId: uuid("default_organization_id").references(() => organizations.id, { onDelete: "set null" }),
    defaultLocationId: uuid("default_location_id").references(() => pantryLocations.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    foreignKey({ columns: [table.defaultLocationId, table.defaultOrganizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "user_profiles_default_scope_fk" }).onDelete("set null"),
  ],
);

export const organizationMemberships = pgTable(
  "organization_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    status: membershipStatus("status").default("invited").notNull(),
    allLocations: boolean("all_locations").default(false).notNull(),
    invitedBy: uuid("invited_by").references(() => user.id, { onDelete: "set null" }),
    invitedAt: timestamp("invited_at", { withTimezone: true }),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("organization_memberships_org_user_unique").on(table.organizationId, table.userId),
    unique("organization_memberships_id_org_unique").on(table.id, table.organizationId),
    index("organization_memberships_user_status_idx").on(table.userId, table.status),
    index("organization_memberships_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const locationMemberships = pgTable(
  "location_memberships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationMembershipId: uuid("organization_membership_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    locationId: uuid("location_id").notNull(),
    status: membershipStatus("status").default("active").notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("location_memberships_membership_location_unique").on(table.organizationMembershipId, table.locationId),
    foreignKey({ columns: [table.organizationMembershipId, table.organizationId], foreignColumns: [organizationMemberships.id, organizationMemberships.organizationId], name: "location_memberships_membership_scope_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.locationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "location_memberships_location_scope_fk" }).onDelete("restrict"),
    index("location_memberships_location_status_idx").on(table.locationId, table.status),
  ],
);

export const permissions = pgTable(
  "permissions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: text("key").notNull().unique(),
    domain: text("domain").notNull(),
    description: text("description").notNull(),
    riskLevel: permissionRiskLevel("risk_level").default("low").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [check("permissions_key_valid", sql`${table.key} ~ '^[a-z][a-z0-9_]*(\\.[a-z][a-z0-9_]*)+$'`)],
);

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull(),
    scope: roleScope("scope").notNull(),
    isSystemRole: boolean("is_system_role").default(false).notNull(),
    isEditable: boolean("is_editable").default(true).notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("roles_system_slug_idx").on(table.slug).where(sql`${table.organizationId} is null`),
    uniqueIndex("roles_organization_slug_idx").on(table.organizationId, table.slug).where(sql`${table.organizationId} is not null`),
    check("roles_system_ownership", sql`(${table.isSystemRole} and ${table.organizationId} is null and not ${table.isEditable} and ${table.createdBy} is null) or (not ${table.isSystemRole} and ${table.organizationId} is not null and ${table.createdBy} is not null)`),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permissionId] })],
);

export const membershipRoles = pgTable(
  "membership_roles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationMembershipId: uuid("organization_membership_id").notNull().references(() => organizationMemberships.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").references(() => pantryLocations.id, { onDelete: "restrict" }),
    assignedBy: uuid("assigned_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("membership_roles_active_assignment_idx").on(table.organizationMembershipId, table.roleId, sql`coalesce(${table.locationId}, '00000000-0000-0000-0000-000000000000'::uuid)`).where(sql`${table.archivedAt} is null`),
    index("membership_roles_membership_active_idx").on(table.organizationMembershipId, table.expiresAt),
    check("membership_roles_expiry_valid", sql`${table.expiresAt} is null or ${table.expiresAt} > ${table.assignedAt}`),
  ],
);

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    status: invitationStatus("status").default("pending").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").references(() => pantryLocations.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    invitedBy: uuid("invited_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    acceptedBy: uuid("accepted_by").references(() => user.id, { onDelete: "restrict" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organization_invitations_pending_email_idx").on(table.organizationId, sql`lower(${table.email})`).where(sql`${table.status} = 'pending'`),
    foreignKey({ columns: [table.locationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "organization_invitations_location_scope_fk" }).onDelete("restrict"),
    index("organization_invitations_expiry_idx").on(table.expiresAt),
  ],
);

export const operationRequests = pgTable(
  "operation_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    operation: text("operation").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: operationStatus("status").default("started").notNull(),
    response: jsonb("response"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [unique("operation_requests_actor_operation_key_unique").on(table.actorUserId, table.operation, table.idempotencyKey)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    locationId: uuid("location_id").references(() => pantryLocations.id, { onDelete: "restrict" }),
    actorUserId: uuid("actor_user_id").references(() => user.id, { onDelete: "set null" }),
    actorMembershipId: uuid("actor_membership_id").references(() => organizationMemberships.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    source: auditSource("source").default("application").notNull(),
    reason: text("reason"),
    requestId: uuid("request_id").notNull(),
    previousValues: jsonb("previous_values"),
    newValues: jsonb("new_values"),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.locationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "audit_logs_location_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.actorMembershipId, table.organizationId], foreignColumns: [organizationMemberships.id, organizationMemberships.organizationId], name: "audit_logs_membership_scope_fk" }).onDelete("restrict"),
    index("audit_logs_organization_created_idx").on(table.organizationId, table.createdAt),
    index("audit_logs_action_created_idx").on(table.organizationId, table.action, table.createdAt),
  ],
);

export const developmentMessages = pgTable("development_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  kind: text("kind").notNull(),
  recipient: text("recipient").notNull(),
  actionUrl: text("action_url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
});

// --- Prompt 3: inventory ledger foundation ---

export const unitDimension = pgEnum("unit_dimension", ["count", "mass", "volume"]);
export const conversionRoundingPolicy = pgEnum("conversion_rounding_policy", ["reject", "floor", "ceiling", "half_up"]);
export const inventoryItemStatus = pgEnum("inventory_item_status", ["active", "archived"]);
export const storageLocationStatus = pgEnum("storage_location_status", ["active", "archived"]);
export const lotStatus = pgEnum("lot_status", ["active", "depleted", "archived"]);
export const inventoryTransactionType = pgEnum("inventory_transaction_type", [
  "opening_balance",
  "donation_received",
  "purchase_received",
  "transfer_in",
  "manual_positive_adjustment",
  "distribution",
  "spoilage",
  "damage",
  "expiration",
  "recall_disposal",
  "transfer_out",
  "manual_negative_adjustment",
  "reversal",
  "pickup_fulfillment",
]);

export const unitsOfMeasure = pgTable(
  "units_of_measure",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    abbreviation: text("abbreviation").notNull(),
    dimension: unitDimension("dimension").notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    unique("units_of_measure_id_org_unique").on(table.id, table.organizationId),
    uniqueIndex("units_of_measure_org_abbreviation_idx").on(table.organizationId, sql`lower(${table.abbreviation})`),
    uniqueIndex("units_of_measure_org_name_idx").on(table.organizationId, sql`lower(${table.name})`),
  ],
);

export const inventoryCategories = pgTable(
  "inventory_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description"),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("inventory_categories_id_org_unique").on(table.id, table.organizationId),
    uniqueIndex("inventory_categories_org_slug_idx").on(table.organizationId, table.slug),
    check("inventory_categories_slug_valid", sql`${table.slug} ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'`),
  ],
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id"),
    name: text("name").notNull(),
    sku: text("sku"),
    baseUnitId: uuid("base_unit_id").notNull(),
    status: inventoryItemStatus("status").default("active").notNull(),
    tracksExpiration: boolean("tracks_expiration").default(true).notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("inventory_items_id_org_unique").on(table.id, table.organizationId),
    foreignKey({ columns: [table.categoryId, table.organizationId], foreignColumns: [inventoryCategories.id, inventoryCategories.organizationId], name: "inventory_items_category_scope_fk" }).onDelete("set null"),
    foreignKey({ columns: [table.baseUnitId, table.organizationId], foreignColumns: [unitsOfMeasure.id, unitsOfMeasure.organizationId], name: "inventory_items_base_unit_scope_fk" }).onDelete("restrict"),
    uniqueIndex("inventory_items_org_name_idx").on(table.organizationId, sql`lower(${table.name})`),
    uniqueIndex("inventory_items_org_sku_idx").on(table.organizationId, sql`lower(${table.sku})`).where(sql`${table.sku} is not null`),
    index("inventory_items_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const inventoryItemUnits = pgTable(
  "inventory_item_units",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    unitId: uuid("unit_id").notNull(),
    factor: numeric("factor", { precision: 20, scale: 6 }).notNull(),
    roundingPolicy: conversionRoundingPolicy("rounding_policy").default("reject").notNull(),
    isBaseUnit: boolean("is_base_unit").default(false).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by").references(() => user.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "inventory_item_units_item_scope_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.unitId, table.organizationId], foreignColumns: [unitsOfMeasure.id, unitsOfMeasure.organizationId], name: "inventory_item_units_unit_scope_fk" }).onDelete("restrict"),
    uniqueIndex("inventory_item_units_active_idx").on(table.inventoryItemId, table.unitId).where(sql`${table.isActive}`),
    uniqueIndex("inventory_item_units_base_idx").on(table.inventoryItemId).where(sql`${table.isBaseUnit} and ${table.isActive}`),
    check("inventory_item_units_factor_positive", sql`${table.factor} > 0`),
    check("inventory_item_units_base_factor", sql`not ${table.isBaseUnit} or ${table.factor} = 1`),
  ],
);

export const storageLocations = pgTable(
  "storage_locations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    name: text("name").notNull(),
    code: text("code"),
    status: storageLocationStatus("status").default("active").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("storage_locations_id_org_unique").on(table.id, table.organizationId),
    unique("storage_locations_id_pantry_unique").on(table.id, table.pantryLocationId),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "storage_locations_pantry_scope_fk" }).onDelete("restrict"),
    uniqueIndex("storage_locations_pantry_name_idx").on(table.pantryLocationId, sql`lower(${table.name})`),
    index("storage_locations_pantry_status_idx").on(table.pantryLocationId, table.status),
  ],
);

export const inventoryLots = pgTable(
  "inventory_lots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    storageLocationId: uuid("storage_location_id"),
    lotCode: text("lot_code"),
    status: lotStatus("status").default("active").notNull(),
    receivedDate: date("received_date").defaultNow().notNull(),
    bestByDate: date("best_by_date"),
    useByDate: date("use_by_date"),
    expirationDate: date("expiration_date"),
    sourceType: text("source_type"),
    sourceReference: text("source_reference"),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("inventory_lots_id_org_unique").on(table.id, table.organizationId),
    unique("inventory_lots_id_pantry_unique").on(table.id, table.pantryLocationId),
    unique("inventory_lots_id_item_unique").on(table.id, table.inventoryItemId),
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "inventory_lots_item_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "inventory_lots_pantry_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.storageLocationId, table.pantryLocationId], foreignColumns: [storageLocations.id, storageLocations.pantryLocationId], name: "inventory_lots_storage_scope_fk" }).onDelete("set null"),
    index("inventory_lots_item_location_idx").on(table.organizationId, table.pantryLocationId, table.inventoryItemId, table.status),
    index("inventory_lots_fefo_idx").on(table.pantryLocationId, table.inventoryItemId, table.expirationDate, table.receivedDate),
  ],
);

export const inventoryTransactions = pgTable(
  "inventory_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    inventoryLotId: uuid("inventory_lot_id").notNull(),
    transactionType: inventoryTransactionType("transaction_type").notNull(),
    physicalDelta: numeric("physical_delta", { precision: 20, scale: 6 }).notNull(),
    inputQuantity: numeric("input_quantity", { precision: 20, scale: 6 }),
    inputUnitId: uuid("input_unit_id").references(() => unitsOfMeasure.id, { onDelete: "restrict" }),
    conversionFactor: numeric("conversion_factor", { precision: 20, scale: 6 }),
    roundingDelta: numeric("rounding_delta", { precision: 20, scale: 6 }),
    reasonCode: text("reason_code"),
    reason: text("reason"),
    correlationId: uuid("correlation_id"),
    reversesTransactionId: uuid("reverses_transaction_id"),
    sourceType: text("source_type"),
    sourceReferenceId: uuid("source_reference_id"),
    sourceReference: text("source_reference"),
    actorUserId: uuid("actor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    actorMembershipId: uuid("actor_membership_id").references(() => organizationMemberships.id, { onDelete: "restrict" }),
    requestId: uuid("request_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "inventory_transactions_item_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "inventory_transactions_pantry_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryLotId, table.organizationId], foreignColumns: [inventoryLots.id, inventoryLots.organizationId], name: "inventory_transactions_lot_org_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryLotId, table.pantryLocationId], foreignColumns: [inventoryLots.id, inventoryLots.pantryLocationId], name: "inventory_transactions_lot_pantry_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryLotId, table.inventoryItemId], foreignColumns: [inventoryLots.id, inventoryLots.inventoryItemId], name: "inventory_transactions_lot_item_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.reversesTransactionId], foreignColumns: [table.id], name: "inventory_transactions_reverses_fk" }).onDelete("restrict"),
    index("inventory_transactions_lot_idx").on(table.inventoryLotId),
    index("inventory_transactions_location_created_idx").on(table.organizationId, table.pantryLocationId, table.createdAt),
    uniqueIndex("inventory_transactions_single_reversal_idx").on(table.reversesTransactionId).where(sql`${table.reversesTransactionId} is not null`),
    check("inventory_transactions_delta_nonzero", sql`${table.physicalDelta} <> 0`),
  ],
);

// --- Prompt 4: inventory operations ---

export const donorType = pgEnum("donor_type", ["individual", "business", "nonprofit", "government", "food_bank", "grocery_store", "farm", "religious_organization", "school", "anonymous", "other"]);
export const donorStatus = pgEnum("donor_status", ["active", "archived"]);
export const donationStatus = pgEnum("donation_status", ["draft", "expected", "receiving", "completed", "cancelled"]);
export const purchaseStatus = pgEnum("purchase_status", ["draft", "ordered", "partially_received", "received", "cancelled"]);
export const receivingSourceType = pgEnum("receiving_source_type", ["donation", "purchase", "other"]);
export const receivingStatus = pgEnum("receiving_status", ["draft", "in_progress", "review", "completed", "cancelled"]);
export const receivingLineStatus = pgEnum("receiving_line_status", ["draft", "completed", "cancelled"]);
export const adjustmentRisk = pgEnum("adjustment_risk", ["normal", "high"]);
export const adjustmentStatus = pgEnum("adjustment_status", ["submitted", "approved", "rejected", "posted", "cancelled"]);
export const conditionEventType = pgEnum("condition_event_type", ["spoilage", "damage", "expiration_removal", "recall_disposal", "quarantine_placed", "quarantine_released", "recall_placed", "recall_resolved"]);
export const lotHoldType = pgEnum("lot_hold_type", ["quarantine", "recall"]);
export const lotHoldStatus = pgEnum("lot_hold_status", ["active", "released"]);
export const recallStatus = pgEnum("recall_status", ["draft", "active", "resolved"]);
export const countStatus = pgEnum("count_status", ["draft", "counting", "submitted", "approved", "reconciled", "cancelled", "stale"]);
export const transferStatus = pgEnum("transfer_status", ["draft", "requested", "approved", "dispatched", "partially_received", "received", "discrepancy_resolved", "cancelled"]);

export const donors = pgTable(
  "donors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    type: donorType("donor_type").notNull(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    email: text("email"),
    phoneNumber: text("phone_number"),
    addressLine1: text("address_line_1"),
    addressLine2: text("address_line_2"),
    city: text("city"),
    stateRegion: text("state_region"),
    postalCode: text("postal_code"),
    countryCode: text("country_code").default("US").notNull(),
    externalReference: text("external_reference"),
    notes: text("notes"),
    isAnonymousPlaceholder: boolean("is_anonymous_placeholder").default(false).notNull(),
    status: donorStatus("status").default("active").notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("donors_id_org_unique").on(table.id, table.organizationId),
    uniqueIndex("donors_org_external_reference_idx").on(table.organizationId, table.externalReference).where(sql`${table.externalReference} is not null`),
    uniqueIndex("donors_org_anonymous_idx").on(table.organizationId).where(sql`${table.isAnonymousPlaceholder}`),
    index("donors_org_status_name_idx").on(table.organizationId, table.status, table.name),
    check("donors_name_not_blank", sql`btrim(${table.name}) <> ''`),
    check("donors_archive_state", sql`(${table.status} = 'archived' and ${table.archivedAt} is not null) or (${table.status} = 'active' and ${table.archivedAt} is null)`),
  ],
);

export const donations = pgTable(
  "donations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    donorId: uuid("donor_id"),
    donationNumber: text("donation_number").notNull(),
    status: donationStatus("status").default("draft").notNull(),
    donationDate: date("donation_date").defaultNow().notNull(),
    expectedArrivalAt: timestamp("expected_arrival_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    sourceReference: text("source_reference"),
    estimatedTotalValue: numeric("estimated_total_value", { precision: 14, scale: 2 }),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    completedBy: uuid("completed_by").references(() => user.id, { onDelete: "restrict" }),
    cancelledBy: uuid("cancelled_by").references(() => user.id, { onDelete: "restrict" }),
    cancellationReason: text("cancellation_reason"),
    ...timestamps,
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (table) => [
    unique("donations_id_org_unique").on(table.id, table.organizationId),
    unique("donations_id_location_unique").on(table.id, table.pantryLocationId),
    unique("donations_org_number_unique").on(table.organizationId, table.donationNumber),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "donations_location_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.donorId, table.organizationId], foreignColumns: [donors.id, donors.organizationId], name: "donations_donor_scope_fk" }).onDelete("restrict"),
    index("donations_org_location_status_date_idx").on(table.organizationId, table.pantryLocationId, table.status, table.donationDate),
  ],
);

export const donationLines = pgTable(
  "donation_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    donationId: uuid("donation_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    expectedQuantity: numeric("expected_quantity", { precision: 20, scale: 6 }),
    expectedUnitId: uuid("expected_unit_id"),
    receivedQuantity: numeric("received_quantity", { precision: 20, scale: 6 }),
    receivedUnitId: uuid("received_unit_id"),
    estimatedValue: numeric("estimated_value", { precision: 14, scale: 2 }),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    foreignKey({ columns: [table.donationId, table.organizationId], foreignColumns: [donations.id, donations.organizationId], name: "donation_lines_donation_org_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.donationId, table.pantryLocationId], foreignColumns: [donations.id, donations.pantryLocationId], name: "donation_lines_donation_location_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "donation_lines_item_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.expectedUnitId, table.organizationId], foreignColumns: [unitsOfMeasure.id, unitsOfMeasure.organizationId], name: "donation_lines_expected_unit_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.receivedUnitId, table.organizationId], foreignColumns: [unitsOfMeasure.id, unitsOfMeasure.organizationId], name: "donation_lines_received_unit_scope_fk" }).onDelete("restrict"),
    index("donation_lines_donation_idx").on(table.donationId),
    check("donation_lines_expected_positive", sql`${table.expectedQuantity} is null or ${table.expectedQuantity} > 0`),
  ],
);

export const purchasedShipments = pgTable(
  "purchased_shipments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    supplierName: text("supplier_name").notNull(),
    supplierReference: text("supplier_reference"),
    status: purchaseStatus("status").default("draft").notNull(),
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    expectedAt: timestamp("expected_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    unique("purchased_shipments_id_org_unique").on(table.id, table.organizationId),
    unique("purchased_shipments_id_location_unique").on(table.id, table.pantryLocationId),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "purchased_shipments_location_scope_fk" }).onDelete("restrict"),
    index("purchased_shipments_org_location_status_idx").on(table.organizationId, table.pantryLocationId, table.status),
  ],
);

export const receivingSessions = pgTable(
  "receiving_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    sourceType: receivingSourceType("source_type").notNull(),
    donationId: uuid("donation_id"),
    purchasedShipmentId: uuid("purchased_shipment_id"),
    status: receivingStatus("status").default("draft").notNull(),
    startedBy: uuid("started_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    completedBy: uuid("completed_by").references(() => user.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancellationReason: text("cancellation_reason"),
    idempotencyKey: uuid("idempotency_key").notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    unique("receiving_sessions_id_org_unique").on(table.id, table.organizationId),
    unique("receiving_sessions_id_location_unique").on(table.id, table.pantryLocationId),
    unique("receiving_sessions_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "receiving_sessions_location_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.donationId, table.organizationId], foreignColumns: [donations.id, donations.organizationId], name: "receiving_sessions_donation_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.purchasedShipmentId, table.organizationId], foreignColumns: [purchasedShipments.id, purchasedShipments.organizationId], name: "receiving_sessions_purchase_scope_fk" }).onDelete("restrict"),
    index("receiving_sessions_org_location_status_idx").on(table.organizationId, table.pantryLocationId, table.status),
    check("receiving_sessions_source_shape", sql`(${table.sourceType} = 'donation' and ${table.donationId} is not null and ${table.purchasedShipmentId} is null) or (${table.sourceType} = 'purchase' and ${table.purchasedShipmentId} is not null and ${table.donationId} is null) or (${table.sourceType} = 'other' and ${table.donationId} is null and ${table.purchasedShipmentId} is null)`),
  ],
);

export const receivingLines = pgTable(
  "receiving_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    receivingSessionId: uuid("receiving_session_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    existingLotId: uuid("existing_lot_id"),
    createdLotId: uuid("created_lot_id"),
    transactionId: uuid("transaction_id").references(() => inventoryTransactions.id, { onDelete: "restrict" }),
    enteredQuantity: numeric("entered_quantity", { precision: 20, scale: 6 }).notNull(),
    enteredUnitId: uuid("entered_unit_id").notNull(),
    resolvedConversionFactor: numeric("resolved_conversion_factor", { precision: 20, scale: 6 }),
    normalizedBaseQuantity: numeric("normalized_base_quantity", { precision: 20, scale: 6 }),
    lotNumber: text("lot_number"),
    receivedDate: date("received_date").defaultNow().notNull(),
    bestByDate: date("best_by_date"),
    useByDate: date("use_by_date"),
    expirationDate: date("expiration_date"),
    storageLocationId: uuid("storage_location_id"),
    condition: text("condition").default("good").notNull(),
    estimatedValue: numeric("estimated_value", { precision: 14, scale: 2 }),
    notes: text("notes"),
    status: receivingLineStatus("line_status").default("draft").notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({ columns: [table.receivingSessionId, table.organizationId], foreignColumns: [receivingSessions.id, receivingSessions.organizationId], name: "receiving_lines_session_org_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.receivingSessionId, table.pantryLocationId], foreignColumns: [receivingSessions.id, receivingSessions.pantryLocationId], name: "receiving_lines_session_location_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "receiving_lines_item_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.enteredUnitId, table.organizationId], foreignColumns: [unitsOfMeasure.id, unitsOfMeasure.organizationId], name: "receiving_lines_unit_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.existingLotId, table.organizationId], foreignColumns: [inventoryLots.id, inventoryLots.organizationId], name: "receiving_lines_existing_lot_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.createdLotId, table.organizationId], foreignColumns: [inventoryLots.id, inventoryLots.organizationId], name: "receiving_lines_created_lot_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.storageLocationId, table.pantryLocationId], foreignColumns: [storageLocations.id, storageLocations.pantryLocationId], name: "receiving_lines_storage_scope_fk" }).onDelete("restrict"),
    index("receiving_lines_session_idx").on(table.receivingSessionId),
    check("receiving_lines_quantity_positive", sql`${table.enteredQuantity} > 0`),
    check("receiving_lines_result_shape", sql`${table.status} <> 'completed' or (${table.transactionId} is not null and (${table.existingLotId} is not null or ${table.createdLotId} is not null) and ${table.normalizedBaseQuantity} > 0)`),
  ],
);

export const adjustmentRequests = pgTable(
  "adjustment_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    inventoryLotId: uuid("inventory_lot_id").notNull(),
    direction: text("direction").notNull(),
    enteredQuantity: numeric("entered_quantity", { precision: 20, scale: 6 }).notNull(),
    enteredUnitId: uuid("entered_unit_id").notNull(),
    resolvedConversionFactor: numeric("resolved_conversion_factor", { precision: 20, scale: 6 }).notNull(),
    normalizedBaseQuantity: numeric("normalized_base_quantity", { precision: 20, scale: 6 }).notNull(),
    risk: adjustmentRisk("risk").notNull(),
    status: adjustmentStatus("status").default("submitted").notNull(),
    reasonCode: text("reason_code").notNull(),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "restrict" }),
    rejectedBy: uuid("rejected_by").references(() => user.id, { onDelete: "restrict" }),
    decisionReason: text("decision_reason"),
    transactionId: uuid("transaction_id").references(() => inventoryTransactions.id, { onDelete: "restrict" }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    ...timestamps,
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (table) => [
    unique("adjustment_requests_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "adjustment_requests_location_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "adjustment_requests_item_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryLotId, table.organizationId], foreignColumns: [inventoryLots.id, inventoryLots.organizationId], name: "adjustment_requests_lot_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.enteredUnitId, table.organizationId], foreignColumns: [unitsOfMeasure.id, unitsOfMeasure.organizationId], name: "adjustment_requests_unit_scope_fk" }).onDelete("restrict"),
    index("adjustment_requests_org_location_status_idx").on(table.organizationId, table.pantryLocationId, table.status),
    check("adjustment_requests_direction_valid", sql`${table.direction} in ('positive','negative')`),
    check("adjustment_requests_quantities_positive", sql`${table.enteredQuantity} > 0 and ${table.normalizedBaseQuantity} > 0 and ${table.resolvedConversionFactor} > 0`),
    check("adjustment_requests_no_self_approval", sql`${table.approvedBy} is null or ${table.approvedBy} <> ${table.requestedBy}`),
  ],
);

export const inventoryRecalls = pgTable(
  "inventory_recalls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    referenceCode: text("reference_code").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    status: recallStatus("status").default("draft").notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    resolvedBy: uuid("resolved_by").references(() => user.id, { onDelete: "restrict" }),
    resolution: text("resolution"),
    ...timestamps,
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [unique("inventory_recalls_org_reference_unique").on(table.organizationId, table.referenceCode), index("inventory_recalls_org_status_idx").on(table.organizationId, table.status)],
);

export const inventoryConditionEvents = pgTable(
  "inventory_condition_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    inventoryLotId: uuid("inventory_lot_id").notNull(),
    eventType: conditionEventType("event_type").notNull(),
    enteredQuantity: numeric("entered_quantity", { precision: 20, scale: 6 }),
    enteredUnitId: uuid("entered_unit_id"),
    normalizedBaseQuantity: numeric("normalized_base_quantity", { precision: 20, scale: 6 }),
    transactionId: uuid("transaction_id").references(() => inventoryTransactions.id, { onDelete: "restrict" }),
    recallId: uuid("recall_id").references(() => inventoryRecalls.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    actorUserId: uuid("actor_user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("inventory_condition_events_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "inventory_condition_events_location_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "inventory_condition_events_item_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryLotId, table.organizationId], foreignColumns: [inventoryLots.id, inventoryLots.organizationId], name: "inventory_condition_events_lot_scope_fk" }).onDelete("restrict"),
    index("inventory_condition_events_lot_created_idx").on(table.inventoryLotId, table.createdAt),
    check("inventory_condition_events_quantity_shape", sql`(${table.eventType} in ('spoilage','damage','expiration_removal','recall_disposal') and ${table.enteredQuantity} > 0 and ${table.enteredUnitId} is not null and ${table.normalizedBaseQuantity} > 0 and ${table.transactionId} is not null) or (${table.eventType} in ('quarantine_placed','quarantine_released','recall_placed','recall_resolved') and ${table.enteredQuantity} is null and ${table.enteredUnitId} is null and ${table.normalizedBaseQuantity} is null and ${table.transactionId} is null)`),
  ],
);

export const inventoryRecallLots = pgTable(
  "inventory_recall_lots",
  {
    recallId: uuid("recall_id").notNull().references(() => inventoryRecalls.id, { onDelete: "cascade" }),
    inventoryLotId: uuid("inventory_lot_id").notNull().references(() => inventoryLots.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.recallId, table.inventoryLotId] }), foreignKey({ columns: [table.inventoryLotId, table.organizationId], foreignColumns: [inventoryLots.id, inventoryLots.organizationId], name: "inventory_recall_lots_scope_fk" }).onDelete("restrict")],
);

export const inventoryLotHolds = pgTable(
  "inventory_lot_holds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    inventoryLotId: uuid("inventory_lot_id").notNull(),
    holdType: lotHoldType("hold_type").notNull(),
    status: lotHoldStatus("status").default("active").notNull(),
    conditionEventId: uuid("condition_event_id").notNull().references(() => inventoryConditionEvents.id, { onDelete: "restrict" }),
    recallId: uuid("recall_id").references(() => inventoryRecalls.id, { onDelete: "restrict" }),
    placedBy: uuid("placed_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    releasedBy: uuid("released_by").references(() => user.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    resolution: text("resolution"),
    placedAt: timestamp("placed_at", { withTimezone: true }).defaultNow().notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({ columns: [table.inventoryLotId, table.organizationId], foreignColumns: [inventoryLots.id, inventoryLots.organizationId], name: "inventory_lot_holds_lot_org_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryLotId, table.pantryLocationId], foreignColumns: [inventoryLots.id, inventoryLots.pantryLocationId], name: "inventory_lot_holds_lot_location_fk" }).onDelete("restrict"),
    uniqueIndex("inventory_lot_holds_active_type_idx").on(table.inventoryLotId, table.holdType).where(sql`${table.status} = 'active'`),
    index("inventory_lot_holds_org_status_idx").on(table.organizationId, table.status, table.holdType),
  ],
);

export const cycleCountSessions = pgTable(
  "cycle_count_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    status: countStatus("status").default("draft").notNull(),
    startedBy: uuid("started_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    submittedBy: uuid("submitted_by").references(() => user.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "restrict" }),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).defaultNow().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [unique("cycle_count_sessions_org_idempotency_unique").on(table.organizationId, table.idempotencyKey), foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "cycle_count_sessions_location_scope_fk" }).onDelete("restrict"), index("cycle_count_sessions_location_status_idx").on(table.organizationId, table.pantryLocationId, table.status), check("cycle_count_sessions_no_self_approval", sql`${table.approvedBy} is null or ${table.approvedBy} <> ${table.startedBy}`)],
);

export const cycleCountEntries = pgTable(
  "cycle_count_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    countSessionId: uuid("count_session_id").notNull().references(() => cycleCountSessions.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    inventoryLotId: uuid("inventory_lot_id").notNull(),
    snapshotQuantity: numeric("snapshot_quantity", { precision: 20, scale: 6 }).notNull(),
    countedQuantity: numeric("counted_quantity", { precision: 20, scale: 6 }),
    countedUnitId: uuid("counted_unit_id"),
    normalizedCountedQuantity: numeric("normalized_counted_quantity", { precision: 20, scale: 6 }),
    varianceQuantity: numeric("variance_quantity", { precision: 20, scale: 6 }),
    countedBy: uuid("counted_by").references(() => user.id, { onDelete: "restrict" }),
    countedAt: timestamp("counted_at", { withTimezone: true }),
    transactionId: uuid("transaction_id").references(() => inventoryTransactions.id, { onDelete: "restrict" }),
    notes: text("notes"),
    ...timestamps,
  },
  (table) => [
    unique("cycle_count_entries_session_lot_unique").on(table.countSessionId, table.inventoryLotId),
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "cycle_count_entries_item_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryLotId, table.organizationId], foreignColumns: [inventoryLots.id, inventoryLots.organizationId], name: "cycle_count_entries_lot_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryLotId, table.pantryLocationId], foreignColumns: [inventoryLots.id, inventoryLots.pantryLocationId], name: "cycle_count_entries_lot_location_fk" }).onDelete("restrict"),
    index("cycle_count_entries_session_idx").on(table.countSessionId),
    check("cycle_count_entries_count_nonnegative", sql`${table.countedQuantity} is null or ${table.countedQuantity} >= 0`),
  ],
);

export const inventoryTransfers = pgTable(
  "inventory_transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    transferNumber: text("transfer_number").notNull(),
    sourceLocationId: uuid("source_location_id").notNull(),
    destinationLocationId: uuid("destination_location_id").notNull(),
    status: transferStatus("status").default("draft").notNull(),
    requestedBy: uuid("requested_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    approvedBy: uuid("approved_by").references(() => user.id, { onDelete: "restrict" }),
    dispatchedBy: uuid("dispatched_by").references(() => user.id, { onDelete: "restrict" }),
    receivedBy: uuid("received_by").references(() => user.id, { onDelete: "restrict" }),
    cancelledBy: uuid("cancelled_by").references(() => user.id, { onDelete: "restrict" }),
    cancellationReason: text("cancellation_reason"),
    discrepancyNotes: text("discrepancy_notes"),
    idempotencyKey: uuid("idempotency_key").notNull(),
    notes: text("notes"),
    requestedAt: timestamp("requested_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    unique("inventory_transfers_org_number_unique").on(table.organizationId, table.transferNumber),
    unique("inventory_transfers_org_idempotency_unique").on(table.organizationId, table.idempotencyKey),
    foreignKey({ columns: [table.sourceLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "inventory_transfers_source_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.destinationLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "inventory_transfers_destination_scope_fk" }).onDelete("restrict"),
    index("inventory_transfers_org_status_idx").on(table.organizationId, table.status),
    index("inventory_transfers_source_status_idx").on(table.sourceLocationId, table.status),
    index("inventory_transfers_destination_status_idx").on(table.destinationLocationId, table.status),
    check("inventory_transfers_distinct_locations", sql`${table.sourceLocationId} <> ${table.destinationLocationId}`),
    check("inventory_transfers_no_self_approval", sql`${table.approvedBy} is null or ${table.approvedBy} <> ${table.requestedBy}`),
  ],
);

export const inventoryTransferLines = pgTable(
  "inventory_transfer_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transferId: uuid("transfer_id").notNull().references(() => inventoryTransfers.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    sourceLotId: uuid("source_lot_id").notNull(),
    requestedQuantity: numeric("requested_quantity", { precision: 20, scale: 6 }).notNull(),
    requestedUnitId: uuid("requested_unit_id").notNull(),
    resolvedConversionFactor: numeric("resolved_conversion_factor", { precision: 20, scale: 6 }).notNull(),
    requestedBaseQuantity: numeric("requested_base_quantity", { precision: 20, scale: 6 }).notNull(),
    dispatchedBaseQuantity: numeric("dispatched_base_quantity", { precision: 20, scale: 6 }).default("0").notNull(),
    receivedBaseQuantity: numeric("received_base_quantity", { precision: 20, scale: 6 }).default("0").notNull(),
    transferOutTransactionId: uuid("transfer_out_transaction_id").references(() => inventoryTransactions.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    unique("inventory_transfer_lines_transfer_lot_unique").on(table.transferId, table.sourceLotId),
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "inventory_transfer_lines_item_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.sourceLotId, table.organizationId], foreignColumns: [inventoryLots.id, inventoryLots.organizationId], name: "inventory_transfer_lines_lot_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.requestedUnitId, table.organizationId], foreignColumns: [unitsOfMeasure.id, unitsOfMeasure.organizationId], name: "inventory_transfer_lines_unit_scope_fk" }).onDelete("restrict"),
    index("inventory_transfer_lines_transfer_idx").on(table.transferId),
    index("inventory_transfer_lines_source_lot_idx").on(table.sourceLotId),
    check("inventory_transfer_lines_quantities_valid", sql`${table.requestedQuantity} > 0 and ${table.requestedBaseQuantity} > 0 and ${table.dispatchedBaseQuantity} >= 0 and ${table.dispatchedBaseQuantity} <= ${table.requestedBaseQuantity} and ${table.receivedBaseQuantity} >= 0 and ${table.receivedBaseQuantity} <= ${table.dispatchedBaseQuantity}`),
  ],
);

export const inventoryTransferReceipts = pgTable(
  "inventory_transfer_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transferId: uuid("transfer_id").notNull().references(() => inventoryTransfers.id, { onDelete: "restrict" }),
    transferLineId: uuid("transfer_line_id").notNull().references(() => inventoryTransferLines.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").notNull(),
    destinationLocationId: uuid("destination_location_id").notNull(),
    destinationLotId: uuid("destination_lot_id").notNull(),
    receivedBaseQuantity: numeric("received_base_quantity", { precision: 20, scale: 6 }).notNull(),
    transferInTransactionId: uuid("transfer_in_transaction_id").notNull().references(() => inventoryTransactions.id, { onDelete: "restrict" }),
    receivedBy: uuid("received_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    discrepancyReason: text("discrepancy_reason"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("inventory_transfer_receipts_transfer_idempotency_unique").on(table.transferId, table.idempotencyKey),
    foreignKey({ columns: [table.destinationLotId, table.organizationId], foreignColumns: [inventoryLots.id, inventoryLots.organizationId], name: "inventory_transfer_receipts_lot_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.destinationLotId, table.destinationLocationId], foreignColumns: [inventoryLots.id, inventoryLots.pantryLocationId], name: "inventory_transfer_receipts_lot_location_fk" }).onDelete("restrict"),
    index("inventory_transfer_receipts_line_idx").on(table.transferLineId, table.receivedAt),
    check("inventory_transfer_receipts_quantity_positive", sql`${table.receivedBaseQuantity} > 0`),
  ],
);

// --- Prompt 5: households, appointments, reservations, and pickup fulfillment ---

export const householdStatus = pgEnum("household_status", ["active", "temporarily_inactive", "suspended", "archived", "merged"]);
export const householdContactType = pgEnum("household_contact_type", ["primary", "alternate", "emergency", "caregiver", "authorized_pickup"]);
export const householdPreferenceType = pgEnum("household_preference_type", ["dietary", "allergen", "accessibility", "pickup"]);
export const smsConsentStatus = pgEnum("sms_consent_status", ["unknown", "consented", "opted_out", "revoked", "invalid_number"]);
export const smsConsentSource = pgEnum("sms_consent_source", ["paper_form", "verbal", "web_form", "inbound_start", "imported", "administrative_correction"]);
export const packageLineType = pgEnum("package_line_type", ["exact_item", "category_choice", "optional_item"]);
export const appointmentType = pgEnum("appointment_type", ["scheduled_pickup", "recurring_pickup", "walk_in", "emergency_pickup", "special_distribution"]);
export const appointmentStatus = pgEnum("appointment_status", ["draft", "scheduled", "confirmed", "arrived", "partially_completed", "completed", "no_show", "cancelled", "rescheduled"]);
export const reservationStatus = pgEnum("reservation_status", ["active", "partially_fulfilled", "fulfilled", "released", "expired", "cancelled"]);
export const reservationAllocationStatus = pgEnum("reservation_allocation_status", ["active", "released", "fulfilled"]);
export const fulfillmentStatus = pgEnum("fulfillment_status", ["draft", "completed", "partially_completed", "corrected"]);

export const households = pgTable(
  "households",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    householdNumber: text("household_number").notNull(),
    status: householdStatus("status").default("active").notNull(),
    displayName: text("display_name").notNull(),
    preferredLanguage: text("preferred_language").default("en").notNull(),
    householdSize: integer("household_size").default(1).notNull(),
    adultCount: integer("adult_count"),
    childCount: integer("child_count"),
    seniorCount: integer("senior_count"),
    defaultPantryLocationId: uuid("default_pantry_location_id"),
    operationalNotes: text("operational_notes"),
    sensitiveNotes: text("sensitive_notes"),
    externalReference: text("external_reference"),
    mergedIntoHouseholdId: uuid("merged_into_household_id"),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("households_id_org_unique").on(table.id, table.organizationId),
    unique("households_org_number_unique").on(table.organizationId, table.householdNumber),
    foreignKey({ columns: [table.defaultPantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "households_default_location_scope_fk" }).onDelete("set null"),
    index("households_org_status_idx").on(table.organizationId, table.status),
  ],
);

export const householdContacts = pgTable(
  "household_contacts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    householdId: uuid("household_id").notNull(),
    contactType: householdContactType("contact_type").default("primary").notNull(),
    name: text("name").notNull(),
    relationshipLabel: text("relationship_label"),
    phoneNumber: text("phone_number"),
    phoneNormalized: text("phone_normalized"),
    email: text("email"),
    isAuthorizedPickup: boolean("is_authorized_pickup").default(false).notNull(),
    preferredLanguage: text("preferred_language"),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({ columns: [table.householdId, table.organizationId], foreignColumns: [households.id, households.organizationId], name: "household_contacts_household_scope_fk" }).onDelete("cascade"),
    index("household_contacts_household_idx").on(table.householdId, table.isActive),
  ],
);

export const householdPreferences = pgTable(
  "household_preferences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    householdId: uuid("household_id").notNull(),
    preferenceType: householdPreferenceType("preference_type").notNull(),
    valueCode: text("value_code").notNull(),
    displayLabel: text("display_label").notNull(),
    severity: text("severity").default("info").notNull(),
    notes: text("notes"),
    isActive: boolean("is_active").default(true).notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.householdId, table.organizationId], foreignColumns: [households.id, households.organizationId], name: "household_preferences_household_scope_fk" }).onDelete("cascade"),
    index("household_preferences_household_idx").on(table.householdId, table.isActive),
  ],
);

export const smsConsents = pgTable(
  "sms_consents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    householdId: uuid("household_id").notNull(),
    householdContactId: uuid("household_contact_id").references(() => householdContacts.id, { onDelete: "set null" }),
    phoneNormalized: text("phone_normalized").notNull(),
    status: smsConsentStatus("status").default("unknown").notNull(),
    consentSource: smsConsentSource("consent_source").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).defaultNow().notNull(),
    recordedBy: uuid("recorded_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.householdId, table.organizationId], foreignColumns: [households.id, households.organizationId], name: "sms_consents_household_scope_fk" }).onDelete("cascade"),
    index("sms_consents_phone_idx").on(table.organizationId, table.phoneNormalized, table.effectiveAt),
  ],
);

export const pickupPackageTemplates = pgTable(
  "pickup_package_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
    pantryLocationId: uuid("pantry_location_id"),
    name: text("name").notNull(),
    description: text("description"),
    packageType: text("package_type").default("standard").notNull(),
    allowSubstitutions: boolean("allow_substitutions").default(true).notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    unique("pickup_package_templates_id_org_unique").on(table.id, table.organizationId),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "pickup_package_templates_location_scope_fk" }).onDelete("set null"),
  ],
);

export const pickupPackageTemplateLines = pgTable(
  "pickup_package_template_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    packageTemplateId: uuid("package_template_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    inventoryItemId: uuid("inventory_item_id"),
    inventoryCategoryId: uuid("inventory_category_id"),
    lineType: packageLineType("line_type").default("exact_item").notNull(),
    baseQuantity: numeric("base_quantity", { precision: 20, scale: 6 }).notNull(),
    isRequired: boolean("is_required").default(true).notNull(),
    allowSubstitution: boolean("allow_substitution").default(true).notNull(),
    priority: integer("priority").default(100).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.packageTemplateId, table.organizationId], foreignColumns: [pickupPackageTemplates.id, pickupPackageTemplates.organizationId], name: "package_lines_template_scope_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "package_lines_item_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryCategoryId, table.organizationId], foreignColumns: [inventoryCategories.id, inventoryCategories.organizationId], name: "package_lines_category_scope_fk" }).onDelete("restrict"),
    index("package_lines_template_idx").on(table.packageTemplateId, table.priority),
  ],
);

export const householdSizePackageRules = pgTable(
  "household_size_package_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    packageTemplateId: uuid("package_template_id").notNull(),
    minimumHouseholdSize: integer("minimum_household_size").notNull(),
    maximumHouseholdSize: integer("maximum_household_size"),
    quantityMultiplier: numeric("quantity_multiplier", { precision: 10, scale: 4 }).notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({ columns: [table.packageTemplateId, table.organizationId], foreignColumns: [pickupPackageTemplates.id, pickupPackageTemplates.organizationId], name: "size_rules_template_scope_fk" }).onDelete("cascade"),
  ],
);

export const appointmentRecurrenceSeries = pgTable(
  "appointment_recurrence_series",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    householdId: uuid("household_id").notNull(),
    frequency: text("frequency").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    occurrenceCount: integer("occurrence_count"),
    packageTemplateId: uuid("package_template_id"),
    status: text("status").default("active").notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.householdId, table.organizationId], foreignColumns: [households.id, households.organizationId], name: "recurrence_household_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "recurrence_location_scope_fk" }).onDelete("restrict"),
  ],
);

export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    householdId: uuid("household_id").notNull(),
    appointmentNumber: text("appointment_number").notNull(),
    appointmentType: appointmentType("appointment_type").default("scheduled_pickup").notNull(),
    status: appointmentStatus("status").default("scheduled").notNull(),
    scheduledStartAt: timestamp("scheduled_start_at", { withTimezone: true }).notNull(),
    scheduledEndAt: timestamp("scheduled_end_at", { withTimezone: true }).notNull(),
    packageTemplateId: uuid("package_template_id"),
    householdSizeSnapshot: integer("household_size_snapshot").notNull(),
    preferredLanguageSnapshot: text("preferred_language_snapshot"),
    specialInstructions: text("special_instructions"),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedInBy: uuid("checked_in_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: uuid("completed_by"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by"),
    cancellationReason: text("cancellation_reason"),
    noShowAt: timestamp("no_show_at", { withTimezone: true }),
    noShowBy: uuid("no_show_by"),
    rescheduledFromAppointmentId: uuid("rescheduled_from_appointment_id"),
    rescheduledToAppointmentId: uuid("rescheduled_to_appointment_id"),
    recurrenceSeriesId: uuid("recurrence_series_id"),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("appointments_id_org_unique").on(table.id, table.organizationId),
    unique("appointments_id_location_unique").on(table.id, table.pantryLocationId),
    unique("appointments_id_household_unique").on(table.id, table.householdId),
    unique("appointments_org_number_unique").on(table.organizationId, table.appointmentNumber),
    foreignKey({ columns: [table.householdId, table.organizationId], foreignColumns: [households.id, households.organizationId], name: "appointments_household_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.pantryLocationId, table.organizationId], foreignColumns: [pantryLocations.id, pantryLocations.organizationId], name: "appointments_location_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.packageTemplateId, table.organizationId], foreignColumns: [pickupPackageTemplates.id, pickupPackageTemplates.organizationId], name: "appointments_template_scope_fk" }).onDelete("set null"),
    index("appointments_org_location_start_idx").on(table.organizationId, table.pantryLocationId, table.scheduledStartAt),
    index("appointments_household_status_idx").on(table.householdId, table.status),
    check("appointments_window_valid", sql`${table.scheduledStartAt} < ${table.scheduledEndAt}`),
  ],
);

export const appointmentStatusHistory = pgTable(
  "appointment_status_history",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    fromStatus: appointmentStatus("from_status"),
    toStatus: appointmentStatus("to_status").notNull(),
    reason: text("reason"),
    changedBy: uuid("changed_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    changedAt: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.appointmentId, table.organizationId], foreignColumns: [appointments.id, appointments.organizationId], name: "status_history_appointment_scope_fk" }).onDelete("cascade"),
    index("status_history_appointment_idx").on(table.appointmentId, table.changedAt),
  ],
);

export const appointmentAllocations = pgTable(
  "appointment_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    appointmentId: uuid("appointment_id").notNull().unique("appointment_allocations_appointment_unique"),
    packageTemplateId: uuid("package_template_id"),
    templateSnapshot: jsonb("template_snapshot").notNull(),
    householdSizeSnapshot: integer("household_size_snapshot").notNull(),
    sizeMultiplierSnapshot: numeric("size_multiplier_snapshot", { precision: 10, scale: 4 }).notNull(),
    overrideReason: text("override_reason"),
    generatedBy: uuid("generated_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("appointment_allocations_id_org_unique").on(table.id, table.organizationId),
    foreignKey({ columns: [table.appointmentId, table.organizationId], foreignColumns: [appointments.id, appointments.organizationId], name: "allocations_appointment_scope_fk" }).onDelete("cascade"),
  ],
);

export const appointmentAllocationLines = pgTable(
  "appointment_allocation_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appointmentAllocationId: uuid("appointment_allocation_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id"),
    inventoryCategoryId: uuid("inventory_category_id"),
    lineType: packageLineType("line_type").notNull(),
    requestedBaseQuantity: numeric("requested_base_quantity", { precision: 20, scale: 6 }).notNull(),
    isRequired: boolean("is_required").default(true).notNull(),
    allowSubstitution: boolean("allow_substitution").default(true).notNull(),
    priority: integer("priority").default(100).notNull(),
    sourceTemplateLineId: uuid("source_template_line_id"),
    overrideReason: text("override_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("allocation_lines_id_item_unique").on(table.id, table.inventoryItemId),
    foreignKey({ columns: [table.appointmentAllocationId, table.organizationId], foreignColumns: [appointmentAllocations.id, appointmentAllocations.organizationId], name: "allocation_lines_allocation_scope_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "allocation_lines_item_scope_fk" }).onDelete("restrict"),
    index("allocation_lines_allocation_idx").on(table.appointmentAllocationId, table.priority),
  ],
);

export const inventoryReservations = pgTable(
  "inventory_reservations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    householdId: uuid("household_id").notNull(),
    status: reservationStatus("status").default("active").notNull(),
    reservedBy: uuid("reserved_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    releasedBy: uuid("released_by"),
    releaseReason: text("release_reason"),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("inventory_reservations_id_org_unique").on(table.id, table.organizationId),
    unique("inventory_reservations_id_appointment_unique").on(table.id, table.appointmentId),
    unique("inventory_reservations_idempotency_unique").on(table.organizationId, table.idempotencyKey),
    uniqueIndex("reservations_active_per_appointment_idx").on(table.appointmentId).where(sql`${table.status} in ('active', 'partially_fulfilled')`),
    foreignKey({ columns: [table.appointmentId, table.organizationId], foreignColumns: [appointments.id, appointments.organizationId], name: "reservations_appointment_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.appointmentId, table.pantryLocationId], foreignColumns: [appointments.id, appointments.pantryLocationId], name: "reservations_appointment_location_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.appointmentId, table.householdId], foreignColumns: [appointments.id, appointments.householdId], name: "reservations_appointment_household_fk" }).onDelete("restrict"),
    index("reservations_org_status_idx").on(table.organizationId, table.pantryLocationId, table.status),
  ],
);

export const inventoryReservationLines = pgTable(
  "inventory_reservation_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationId: uuid("reservation_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    appointmentAllocationLineId: uuid("appointment_allocation_line_id"),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    requestedBaseQuantity: numeric("requested_base_quantity", { precision: 20, scale: 6 }).notNull(),
    reservedBaseQuantity: numeric("reserved_base_quantity", { precision: 20, scale: 6 }).default("0").notNull(),
    fulfilledBaseQuantity: numeric("fulfilled_base_quantity", { precision: 20, scale: 6 }).default("0").notNull(),
    releasedBaseQuantity: numeric("released_base_quantity", { precision: 20, scale: 6 }).default("0").notNull(),
    isRequired: boolean("is_required").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("reservation_lines_id_item_unique").on(table.id, table.inventoryItemId),
    foreignKey({ columns: [table.reservationId, table.organizationId], foreignColumns: [inventoryReservations.id, inventoryReservations.organizationId], name: "reservation_lines_reservation_scope_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.inventoryItemId, table.organizationId], foreignColumns: [inventoryItems.id, inventoryItems.organizationId], name: "reservation_lines_item_scope_fk" }).onDelete("restrict"),
    index("reservation_lines_reservation_idx").on(table.reservationId),
  ],
);

export const inventoryReservationLotAllocations = pgTable(
  "inventory_reservation_lot_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reservationLineId: uuid("reservation_line_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    inventoryLotId: uuid("inventory_lot_id").notNull(),
    reservedBaseQuantity: numeric("reserved_base_quantity", { precision: 20, scale: 6 }).notNull(),
    fulfilledBaseQuantity: numeric("fulfilled_base_quantity", { precision: 20, scale: 6 }).default("0").notNull(),
    releasedBaseQuantity: numeric("released_base_quantity", { precision: 20, scale: 6 }).default("0").notNull(),
    status: reservationAllocationStatus("status").default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.reservationLineId, table.inventoryItemId], foreignColumns: [inventoryReservationLines.id, inventoryReservationLines.inventoryItemId], name: "lot_allocations_line_item_fk" }).onDelete("cascade"),
    foreignKey({ columns: [table.inventoryLotId, table.inventoryItemId], foreignColumns: [inventoryLots.id, inventoryLots.inventoryItemId], name: "lot_allocations_lot_item_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryLotId, table.pantryLocationId], foreignColumns: [inventoryLots.id, inventoryLots.pantryLocationId], name: "lot_allocations_lot_location_fk" }).onDelete("restrict"),
    index("lot_allocations_lot_status_idx").on(table.inventoryLotId, table.status),
    index("lot_allocations_line_idx").on(table.reservationLineId),
  ],
);

export const pickupFulfillments = pgTable(
  "pickup_fulfillments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    householdId: uuid("household_id").notNull(),
    reservationId: uuid("reservation_id"),
    status: fulfillmentStatus("status").default("draft").notNull(),
    completedBy: uuid("completed_by"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    correctionOfFulfillmentId: uuid("correction_of_fulfillment_id"),
    correctionReason: text("correction_reason"),
    idempotencyKey: uuid("idempotency_key").notNull(),
    notes: text("notes"),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("pickup_fulfillments_idempotency_unique").on(table.organizationId, table.idempotencyKey),
    foreignKey({ columns: [table.appointmentId, table.organizationId], foreignColumns: [appointments.id, appointments.organizationId], name: "fulfillments_appointment_scope_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.appointmentId, table.householdId], foreignColumns: [appointments.id, appointments.householdId], name: "fulfillments_appointment_household_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.reservationId, table.appointmentId], foreignColumns: [inventoryReservations.id, inventoryReservations.appointmentId], name: "fulfillments_reservation_appointment_fk" }).onDelete("restrict"),
    index("fulfillments_appointment_idx").on(table.appointmentId),
  ],
);

export const pickupFulfillmentLines = pgTable(
  "pickup_fulfillment_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    pickupFulfillmentId: uuid("pickup_fulfillment_id").notNull().references(() => pickupFulfillments.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    reservationLineId: uuid("reservation_line_id"),
    inventoryItemId: uuid("inventory_item_id").notNull(),
    inventoryLotId: uuid("inventory_lot_id").notNull(),
    fulfilledBaseQuantity: numeric("fulfilled_base_quantity", { precision: 20, scale: 6 }).notNull(),
    inventoryTransactionId: uuid("inventory_transaction_id").unique("fulfillment_lines_transaction_unique").references(() => inventoryTransactions.id, { onDelete: "restrict" }),
    unfulfilledReason: text("unfulfilled_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.reservationLineId, table.inventoryItemId], foreignColumns: [inventoryReservationLines.id, inventoryReservationLines.inventoryItemId], name: "fulfillment_lines_line_item_fk" }).onDelete("set null"),
    foreignKey({ columns: [table.inventoryLotId, table.inventoryItemId], foreignColumns: [inventoryLots.id, inventoryLots.inventoryItemId], name: "fulfillment_lines_lot_item_fk" }).onDelete("restrict"),
    foreignKey({ columns: [table.inventoryLotId, table.pantryLocationId], foreignColumns: [inventoryLots.id, inventoryLots.pantryLocationId], name: "fulfillment_lines_lot_location_fk" }).onDelete("restrict"),
    index("fulfillment_lines_fulfillment_idx").on(table.pickupFulfillmentId),
    index("fulfillment_lines_lot_idx").on(table.inventoryLotId),
  ],
);

export const pickupSubstitutions = pgTable(
  "pickup_substitutions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    pantryLocationId: uuid("pantry_location_id").notNull(),
    appointmentId: uuid("appointment_id").notNull(),
    reservationId: uuid("reservation_id").notNull().references(() => inventoryReservations.id, { onDelete: "cascade" }),
    reservationLineId: uuid("reservation_line_id").notNull().references(() => inventoryReservationLines.id, { onDelete: "cascade" }),
    originalInventoryItemId: uuid("original_inventory_item_id").notNull(),
    substituteInventoryItemId: uuid("substitute_inventory_item_id").notNull(),
    reason: text("reason").notNull(),
    createdBy: uuid("created_by").notNull().references(() => user.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({ columns: [table.appointmentId, table.organizationId], foreignColumns: [appointments.id, appointments.organizationId], name: "substitutions_appointment_scope_fk" }).onDelete("cascade"),
  ],
);
