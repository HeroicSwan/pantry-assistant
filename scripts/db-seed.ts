import { createHash, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local", quiet: true });

const isTest = process.argv.includes("--test");
const databaseUrl = isTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
const seedPassword = process.env.SEED_USER_PASSWORD ?? "";

if (!databaseUrl || !seedPassword) throw new Error("DATABASE_URL and SEED_USER_PASSWORD are required.");
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) throw new Error("Seeding is restricted to local PostgreSQL.");
if (isTest && (process.env.NODE_ENV !== "test" || !parsed.pathname.endsWith("_test") || databaseUrl === process.env.DATABASE_URL)) {
  throw new Error("Test seeding requires NODE_ENV=test and a distinct local *_test database.");
}
if (!isTest && parsed.pathname !== "/food_pantry_dev") throw new Error("Development seeding is restricted to food_pantry_dev.");

const ids = {
  roles: {
    administrator: "00000000-0000-4000-8000-000000000001",
    manager: "00000000-0000-4000-8000-000000000002",
    worker: "00000000-0000-4000-8000-000000000003",
    volunteer: "00000000-0000-4000-8000-000000000004",
    viewer: "00000000-0000-4000-8000-000000000005",
  },
  users: {
    admin: "10000000-0000-4000-8000-000000000001",
    manager: "10000000-0000-4000-8000-000000000002",
    worker: "10000000-0000-4000-8000-000000000003",
    volunteer: "10000000-0000-4000-8000-000000000004",
    viewer: "10000000-0000-4000-8000-000000000005",
    suspended: "10000000-0000-4000-8000-000000000006",
    unrelated: "10000000-0000-4000-8000-000000000007",
  },
  organizations: {
    harbor: "20000000-0000-4000-8000-000000000001",
    unrelated: "20000000-0000-4000-8000-000000000002",
  },
  locations: {
    downtown: "30000000-0000-4000-8000-000000000001",
    northside: "30000000-0000-4000-8000-000000000002",
    unrelated: "30000000-0000-4000-8000-000000000003",
  },
};

const permissionRows = [
  ["organization.view", "organization", "View organization details.", "low"],
  ["organization.update", "organization", "Update organization details.", "high"],
  ["organization.archive", "organization", "Archive an organization.", "critical"],
  ["organization.manage_settings", "organization", "Manage security-sensitive organization settings.", "critical"],
  ["location.view", "location", "View permitted pantry locations.", "low"],
  ["location.create", "location", "Create pantry locations.", "high"],
  ["location.update", "location", "Update pantry location details and closure state.", "moderate"],
  ["location.archive", "location", "Archive pantry locations.", "high"],
  ["member.view", "member", "View organization members and their assignments.", "moderate"],
  ["member.invite", "member", "Prepare and revoke member invitations.", "high"],
  ["member.update", "member", "Update membership access.", "high"],
  ["member.suspend", "member", "Suspend an organization membership.", "critical"],
  ["member.archive", "member", "Archive an organization membership.", "critical"],
  ["role.view", "role", "View roles and effective permissions.", "low"],
  ["role.assign", "role", "Assign or remove roles.", "critical"],
  ["role.manage", "role", "Manage organization-defined roles.", "critical"],
  ["automation.manage", "automation", "Configure and run opt-in automated operational actions.", "critical"],
  ["attachment.manage", "attachment", "Upload and manage scoped file attachments.", "high"],
  ["eligibility.manage", "eligibility", "Record and manage household eligibility verification.", "high"],
  ["compliance.manage", "compliance", "Manage country-specific compliance profiles.", "critical"],
  ["inventory.view", "inventory", "View inventory summaries and permitted details.", "low"],
  ["inventory.manage_catalog", "inventory", "Manage inventory items, units, and categories.", "high"],
  ["inventory.receive", "inventory", "Receive inventory.", "moderate"],
  ["inventory.adjust", "inventory", "Create normal inventory adjustments.", "high"],
  ["inventory.adjust_large", "inventory", "Approve high-impact inventory adjustments.", "critical"],
  ["inventory.correct", "inventory", "Reverse and replace an incorrect inventory transaction.", "critical"],
  ["inventory.reverse", "inventory", "Reverse posted inventory transactions.", "critical"],
  ["inventory.transfer", "inventory", "Transfer inventory between locations.", "high"],
  ["inventory.transfer_approve", "inventory", "Approve a requested inventory transfer.", "critical"],
  ["inventory.transfer_dispatch", "inventory", "Dispatch an approved inventory transfer.", "high"],
  ["inventory.transfer_receive", "inventory", "Receive an in-transit inventory transfer.", "high"],
  ["inventory.transfer_cancel", "inventory", "Cancel an inventory transfer before dispatch.", "critical"],
  ["inventory.transfer_discrepancy", "inventory", "Resolve an inventory transfer discrepancy.", "critical"],
  ["inventory.quarantine", "inventory", "Quarantine or release inventory.", "high"],
  ["inventory.quarantine_release", "inventory", "Release quarantined inventory.", "critical"],
  ["inventory.spoilage", "inventory", "Remove spoiled inventory.", "high"],
  ["inventory.damage", "inventory", "Remove damaged inventory.", "high"],
  ["inventory.expiration_remove", "inventory", "Remove expired inventory.", "high"],
  ["inventory.recall", "inventory", "Activate an inventory recall hold.", "critical"],
  ["inventory.recall_resolve", "inventory", "Dispose or release recalled inventory.", "critical"],
  ["inventory.reconcile", "inventory", "Perform inventory reconciliations.", "high"],
  ["inventory.reconcile_approve", "inventory", "Approve and post cycle-count reconciliation.", "critical"],
  ["receiving.view", "receiving", "View receiving sessions.", "low"],
  ["receiving.create", "receiving", "Create donations, purchases, and receiving sessions.", "moderate"],
  ["receiving.complete", "receiving", "Complete a receiving session and post stock.", "high"],
  ["receiving.cancel", "receiving", "Cancel an unposted receiving session.", "high"],
  ["receiving.override_validation", "receiving", "Override a documented receiving validation warning.", "critical"],
  ["donor.view", "donor", "View donor records.", "low"],
  ["donor.create", "donor", "Create donor records.", "moderate"],
  ["donor.update", "donor", "Update donor records.", "moderate"],
  ["donor.archive", "donor", "Archive donor records.", "high"],
  ["donation.view", "donation", "View donation records.", "low"],
  ["donation.create", "donation", "Record donations.", "moderate"],
  ["donation.update", "donation", "Update donation intake records.", "moderate"],
  ["household.view_basic", "household", "View minimized household operational details.", "moderate"],
  ["household.view_contact", "household", "View household contact information.", "high"],
  ["household.view_sensitive", "household", "View sensitive household details.", "high"],
  ["household.create", "household", "Create household records.", "high"],
  ["household.update", "household", "Update household records.", "high"],
  ["household.archive", "household", "Archive household records.", "high"],
  ["household.restore", "household", "Restore household records.", "high"],
  ["household.merge", "household", "Merge duplicate household records.", "critical"],
  ["household.export", "household", "Export household records.", "critical"],
  ["appointment.view", "appointment", "View permitted pickup appointments.", "low"],
  ["appointment.create", "appointment", "Create pickup appointments.", "moderate"],
  ["appointment.update", "appointment", "Update pickup appointments.", "moderate"],
  ["appointment.cancel", "appointment", "Cancel pickup appointments.", "high"],
  ["appointment.reschedule", "appointment", "Reschedule pickup appointments.", "moderate"],
  ["appointment.check_in", "appointment", "Check households in for pickup.", "moderate"],
  ["appointment.complete", "appointment", "Complete controlled pickup workflows.", "high"],
  ["appointment.mark_no_show", "appointment", "Mark a pickup appointment as a no-show.", "moderate"],
  ["appointment.correct", "appointment", "Correct a completed pickup.", "critical"],
  ["package.view", "package", "View pickup package templates.", "low"],
  ["package.manage", "package", "Create and update pickup package templates.", "high"],
  ["reservation.view", "reservation", "View inventory reservations.", "moderate"],
  ["reservation.create", "reservation", "Reserve inventory for a pickup.", "high"],
  ["reservation.release", "reservation", "Release a pickup inventory reservation.", "high"],
  ["reservation.fulfill", "reservation", "Fulfill reserved inventory.", "high"],
  ["pickup.prepare", "pickup", "Prepare a pickup package.", "moderate"],
  ["pickup.substitute", "pickup", "Substitute an approved pickup item.", "high"],
  ["pickup.complete", "pickup", "Complete a pickup and post the inventory ledger.", "critical"],
  ["pickup.correct", "pickup", "Correct a completed pickup fulfillment.", "critical"],
  ["consent.view", "consent", "View SMS consent records.", "high"],
  ["consent.record", "consent", "Record or revoke SMS consent.", "high"],
  ["consent.revoke", "consent", "Record an SMS consent revocation.", "high"],
  ["consent.correct", "consent", "Correct SMS consent history administratively.", "critical"],
  ["forecast.view", "forecast", "View deterministic forecasts.", "low"],
  ["forecast.view_item", "forecast", "View item forecasts.", "low"],
  ["forecast.view_category", "forecast", "View category forecasts.", "low"],
  ["forecast.configure", "forecast", "Configure forecast rules and overrides.", "high"],
  ["forecast.recalculate", "forecast", "Run deterministic forecast recalculation.", "high"],
  ["forecast.override", "forecast", "Create documented forecast overrides.", "critical"],
  ["forecast.view_diagnostics", "forecast", "View forecast data-quality diagnostics.", "moderate"],
  ["alert.view", "alert", "View permitted operational alerts.", "low"],
  ["alert.acknowledge", "alert", "Acknowledge operational alerts.", "moderate"],
  ["alert.manage", "alert", "Acknowledge and resolve operational alerts.", "moderate"],
  ["alert.resolve", "alert", "Resolve operational alerts.", "high"],
  ["alert.dismiss", "alert", "Dismiss an alert with a reason.", "high"],
  ["alert.configure", "alert", "Configure alert behavior.", "high"],
  ["dashboard.view_operations", "dashboard", "View location operations dashboard.", "low"],
  ["dashboard.view_organization", "dashboard", "View organization-wide operations dashboard.", "high"],
  ["dashboard.view_sensitive_metrics", "dashboard", "View sensitive operational metrics.", "high"],
  ["donation_need.view", "donation_need", "View donation-needs recommendations.", "low"],
  ["donation_need.generate", "donation_need", "Generate donation-needs recommendations.", "high"],
  ["donation_need.manage", "donation_need", "Manage donation-needs recommendations.", "high"],
  ["message.view", "message", "View permitted message history.", "moderate"],
  ["message.view_delivery", "message", "View delivery status.", "moderate"],
  ["message.view_inbound", "message", "View inbound messages.", "high"],
  ["message.draft", "message", "Draft messages.", "moderate"],
  ["message.update_draft", "message", "Update message drafts.", "moderate"],
  ["message.delete_draft", "message", "Delete message drafts.", "high"],
  ["message.schedule", "message", "Schedule approved messages.", "high"],
  ["message.send_individual", "message", "Send an individual message after confirmation.", "high"],
  ["message.send_bulk", "message", "Send bulk messages after approval.", "critical"],
  ["message.approve_bulk", "message", "Approve bulk messages.", "critical"],
  ["message.cancel_scheduled", "message", "Cancel scheduled messages.", "high"],
  ["message.retry_failed", "message", "Retry eligible message failures.", "high"],
  ["message.template.view", "message", "View message templates.", "low"],
  ["message.template.create", "message", "Create message templates.", "high"],
  ["message.template.update", "message", "Update message templates.", "high"],
  ["message.template.archive", "message", "Archive message templates.", "high"],
  ["message.settings.view", "message", "View SMS settings.", "high"],
  ["message.settings.manage", "message", "Manage SMS settings.", "critical"],
  ["message.reply", "message", "Reply to inbound messages.", "high"],
  ["message.manage_inbound", "message", "Manage inbound message review.", "high"],
  ["message.manage_templates", "message", "Manage approved message templates.", "high"],
  ["message.manage_settings", "message", "Manage messaging provider settings.", "critical"],
  ["report.view", "report", "View approved reports.", "low"],
  ["report.export", "report", "Export permitted reports.", "high"],
  ["audit.view", "audit", "View security and operations audit logs.", "high"],
  ["assistant.use", "assistant", "Use approved assistant read tools.", "low"],
  ["assistant.view_sensitive", "assistant", "Use assistant tools that may return minimized sensitive data.", "high"],
  ["assistant.propose_actions", "assistant", "Create structured action proposals.", "high"],
  ["assistant.confirm_low_risk", "assistant", "Confirm low-risk assistant proposals.", "high"],
  ["assistant.confirm_high_risk", "assistant", "Confirm high-risk assistant proposals.", "critical"],
  ["assistant.view_inventory", "assistant", "Use scoped inventory read tools.", "low"],
  ["assistant.view_forecast", "assistant", "Use scoped forecast read tools.", "low"],
  ["assistant.draft_message", "assistant", "Draft a message without sending it.", "high"],
  ["assistant.propose_reschedule", "assistant", "Propose an appointment reschedule.", "high"],
  ["assistant.confirm_actions", "assistant", "Confirm a controlled assistant proposal.", "critical"],
  ["assistant.autonomous_write", "assistant", "Allow explicitly enabled assistant automation writes.", "critical"],
  ["assistant.settings", "assistant", "Manage assistant provider settings.", "critical"],
  ["report.view_inventory", "report", "View inventory reports.", "low"],
  ["report.view_donations", "report", "View donation reports.", "low"],
  ["report.view_distributions", "report", "View distribution reports.", "moderate"],
  ["report.view_forecast", "report", "View forecast reports.", "low"],
  ["report.view_messaging", "report", "View aggregate messaging reports.", "high"],
  ["report.weekly_summary", "report", "View weekly operations summaries.", "low"],
  ["report.print", "report", "Open printable reports.", "low"],
  ["report.design", "report", "Create and manage custom report layouts.", "high"],
] as const;

const managerPermissions = ["organization.view", "location.view", "location.update", "member.view", "role.view", "inventory.view", "inventory.receive", "inventory.adjust", "inventory.adjust_large", "inventory.correct", "inventory.reverse", "inventory.transfer", "inventory.transfer_approve", "inventory.transfer_dispatch", "inventory.transfer_receive", "inventory.transfer_cancel", "inventory.transfer_discrepancy", "inventory.quarantine", "inventory.quarantine_release", "inventory.spoilage", "inventory.damage", "inventory.expiration_remove", "inventory.recall", "inventory.recall_resolve", "inventory.reconcile", "inventory.reconcile_approve", "receiving.view", "receiving.create", "receiving.complete", "receiving.cancel", "receiving.override_validation", "donor.view", "donor.create", "donor.update", "donor.archive", "donation.view", "donation.create", "donation.update", "household.view_basic", "household.view_contact", "household.view_sensitive", "household.create", "household.update", "household.archive", "appointment.view", "appointment.create", "appointment.update", "appointment.cancel", "appointment.reschedule", "appointment.check_in", "appointment.complete", "appointment.mark_no_show", "appointment.correct", "package.view", "package.manage", "reservation.view", "reservation.create", "reservation.release", "reservation.fulfill", "pickup.prepare", "pickup.substitute", "pickup.complete", "pickup.correct", "consent.view", "consent.record", "forecast.view", "forecast.configure", "alert.view", "alert.manage", "message.view", "message.draft", "message.schedule", "message.send_individual", "message.send_bulk", "message.approve_bulk", "message.manage_templates", "report.view", "report.export", "assistant.use", "assistant.view_sensitive", "assistant.propose_actions", "assistant.confirm_low_risk", "assistant.confirm_high_risk", "automation.manage", "attachment.manage", "eligibility.manage", "compliance.manage", "report.design"];
const workerPermissions = ["organization.view", "location.view", "inventory.view", "inventory.receive", "inventory.adjust", "inventory.transfer", "inventory.transfer_dispatch", "inventory.transfer_receive", "inventory.quarantine", "inventory.spoilage", "inventory.damage", "inventory.expiration_remove", "inventory.reconcile", "receiving.view", "receiving.create", "receiving.complete", "donor.view", "donor.create", "donation.view", "donation.create", "donation.update", "household.view_basic", "appointment.view", "reservation.view", "reservation.fulfill", "pickup.prepare", "pickup.substitute", "forecast.view", "alert.view", "assistant.use"];
const volunteerPermissions = ["organization.view", "location.view", "inventory.view", "household.view_basic", "appointment.view", "appointment.check_in", "pickup.prepare"];
const viewerPermissions = ["organization.view", "location.view", "inventory.view", "forecast.view", "alert.view", "report.view", "assistant.use"];
managerPermissions.push("forecast.view_item","forecast.view_category","forecast.recalculate","forecast.override","forecast.view_diagnostics","alert.acknowledge","alert.resolve","alert.dismiss","alert.configure","dashboard.view_operations","dashboard.view_organization","dashboard.view_sensitive_metrics","donation_need.view","donation_need.generate","donation_need.manage");
workerPermissions.push("forecast.view_item","forecast.view_category","alert.acknowledge","dashboard.view_operations");
viewerPermissions.push("forecast.view_item","forecast.view_category","dashboard.view_operations","donation_need.view");
managerPermissions.push("message.view_delivery","message.view_inbound","message.update_draft","message.delete_draft","message.cancel_scheduled","message.retry_failed","message.template.view","message.template.create","message.template.update","message.template.archive","message.settings.view","message.reply","message.manage_inbound","consent.revoke","consent.correct","assistant.view_inventory","assistant.view_forecast","assistant.draft_message","assistant.propose_reschedule","assistant.confirm_actions","report.view_inventory","report.view_donations","report.view_distributions","report.view_forecast","report.view_messaging","report.weekly_summary","report.print");
workerPermissions.push("message.view_delivery","message.draft","message.template.view","assistant.view_inventory","assistant.view_forecast","report.view_inventory","report.view_donations","report.view_distributions","report.view_forecast","report.weekly_summary","report.print");
volunteerPermissions.push("message.view_delivery");
viewerPermissions.push("message.view_delivery","report.view_inventory","report.view_donations","report.view_distributions","report.view_forecast","report.view_messaging","report.weekly_summary","report.print");

function stableUuid(value: string) {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

const client = new Client({ connectionString: databaseUrl });

async function seed() {
  await client.connect();
  await client.query("begin");
  try {
    for (const [key, domain, description, risk] of permissionRows) {
      await client.query(`insert into permissions (id, key, domain, description, risk_level) values ($1,$2,$3,$4,$5) on conflict (key) do update set domain=excluded.domain, description=excluded.description, risk_level=excluded.risk_level`, [stableUuid(`permission:${key}`), key, domain, description, risk]);
    }

    const roleRows = [
      [ids.roles.administrator, "Administrator", "administrator", "Organization-wide administration and security-sensitive operations.", "organization"],
      [ids.roles.manager, "Pantry manager", "pantry-manager", "Location-scoped operational management.", "location"],
      [ids.roles.worker, "Inventory worker", "inventory-worker", "Location-scoped receiving and inventory operations.", "location"],
      [ids.roles.volunteer, "Volunteer", "volunteer", "Assigned-location check-in and pickup work.", "location"],
      [ids.roles.viewer, "Read-only viewer", "read-only-viewer", "Organization-wide read-only summaries and approved reports.", "organization"],
    ];
    for (const role of roleRows) {
      await client.query(`insert into roles (id,name,slug,description,scope,is_system_role,is_editable) values ($1,$2,$3,$4,$5,true,false) on conflict (id) do update set name=excluded.name, description=excluded.description`, role);
    }
    await client.query("delete from role_permissions where role_id = any($1::uuid[])", [Object.values(ids.roles)]);
    const roleMatrix = new Map([
      [ids.roles.administrator, permissionRows.map(([key]) => key)],
      [ids.roles.manager, managerPermissions],
      [ids.roles.worker, workerPermissions],
      [ids.roles.volunteer, volunteerPermissions],
      [ids.roles.viewer, viewerPermissions],
    ]);
    for (const [roleId, keys] of roleMatrix) {
      await client.query(`insert into role_permissions (role_id, permission_id) select $1, id from permissions where key = any($2::text[])`, [roleId, keys]);
    }

    const people = [
      [ids.users.admin, "Administrator", "admin@harbor-pantry.example.test"],
      [ids.users.manager, "Pantry Manager", "manager@harbor-pantry.example.test"],
      [ids.users.worker, "Inventory Worker", "worker@harbor-pantry.example.test"],
      [ids.users.volunteer, "Volunteer", "volunteer@harbor-pantry.example.test"],
      [ids.users.viewer, "Read-only Viewer", "viewer@harbor-pantry.example.test"],
      [ids.users.suspended, "Suspended Member", "suspended@harbor-pantry.example.test"],
      [ids.users.unrelated, "Unrelated Administrator", "admin@other-pantry.example.test"],
    ];
    for (const [userId, name, email] of people) {
      await client.query(`insert into "user" (id,name,email,email_verified) values ($1,$2,$3,true) on conflict (id) do update set name=excluded.name,email=excluded.email,email_verified=true`, [userId, name, email]);
      const passwordHash = await hashPassword(seedPassword);
      await client.query(`insert into account (id,account_id,provider_id,user_id,password) values ($1,$2,'credential',$3,$4) on conflict (provider_id,account_id) do update set password=excluded.password`, [stableUuid(`account:${userId}`), userId, userId, passwordHash]);
    }

    await client.query(`insert into organizations (id,name,slug,timezone,email,city,state_region,created_by) values ($1,'Harbor Community Food Pantry','harbor-community-food-pantry','America/New_York','contact@harbor-pantry.example.test','Harbor City','MD',$2) on conflict (id) do update set name=excluded.name`, [ids.organizations.harbor, ids.users.admin]);
    await client.query(`insert into organizations (id,name,slug,timezone,email,city,state_region,created_by) values ($1,'Riverside Mutual Aid Pantry','riverside-mutual-aid-pantry','America/Chicago','contact@riverside-pantry.example.test','Riverside','IL',$2) on conflict (id) do update set name=excluded.name`, [ids.organizations.unrelated, ids.users.unrelated]);
    const locationRows = [
      [ids.locations.downtown, ids.organizations.harbor, "Downtown Pantry", "downtown-pantry", ids.users.admin, "Harbor City", "MD"],
      [ids.locations.northside, ids.organizations.harbor, "Northside Distribution Center", "northside-distribution-center", ids.users.admin, "Harbor City", "MD"],
      [ids.locations.unrelated, ids.organizations.unrelated, "Riverside Main Pantry", "riverside-main-pantry", ids.users.unrelated, "Riverside", "IL"],
    ];
    for (const row of locationRows) {
      await client.query(`insert into pantry_locations (id,organization_id,name,slug,created_by,city,state_region) values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do update set name=excluded.name`, row);
    }

    const membershipRows = [
      [stableUuid("membership:admin"), ids.organizations.harbor, ids.users.admin, true],
      [stableUuid("membership:manager"), ids.organizations.harbor, ids.users.manager, false],
      [stableUuid("membership:worker"), ids.organizations.harbor, ids.users.worker, false],
      [stableUuid("membership:volunteer"), ids.organizations.harbor, ids.users.volunteer, false],
      [stableUuid("membership:viewer"), ids.organizations.harbor, ids.users.viewer, true],
      [stableUuid("membership:suspended"), ids.organizations.harbor, ids.users.suspended, false],
      [stableUuid("membership:unrelated"), ids.organizations.unrelated, ids.users.unrelated, true],
    ];
    for (const [membershipId, organizationId, userId, allLocations] of membershipRows) {
      await client.query(`insert into organization_memberships (id,organization_id,user_id,status,all_locations,joined_at) values ($1,$2,$3,'active',$4,now()) on conflict (organization_id,user_id) do update set status='active',all_locations=excluded.all_locations,archived_at=null,suspended_at=null`, [membershipId, organizationId, userId, allLocations]);
    }

    const locationAssignments = [
      [stableUuid("membership:manager"), ids.organizations.harbor, ids.locations.downtown, ids.users.admin],
      [stableUuid("membership:worker"), ids.organizations.harbor, ids.locations.downtown, ids.users.admin],
      [stableUuid("membership:volunteer"), ids.organizations.harbor, ids.locations.northside, ids.users.admin],
      [stableUuid("membership:suspended"), ids.organizations.harbor, ids.locations.downtown, ids.users.admin],
    ];
    for (const [membershipId, organizationId, locationId, createdBy] of locationAssignments) {
      await client.query(`insert into location_memberships (organization_membership_id,organization_id,location_id,status,created_by) values ($1,$2,$3,'active',$4) on conflict (organization_membership_id,location_id) do update set status='active',archived_at=null`, [membershipId, organizationId, locationId, createdBy]);
    }

    const roleAssignments = [
      ["admin", ids.roles.administrator, null, ids.users.admin],
      ["manager", ids.roles.manager, ids.locations.downtown, ids.users.admin],
      ["worker", ids.roles.worker, ids.locations.downtown, ids.users.admin],
      ["volunteer", ids.roles.volunteer, ids.locations.northside, ids.users.admin],
      ["viewer", ids.roles.viewer, null, ids.users.admin],
      ["suspended", ids.roles.volunteer, ids.locations.downtown, ids.users.admin],
      ["unrelated", ids.roles.administrator, null, ids.users.unrelated],
    ] as const;
    for (const [key, roleId, locationId, assignedBy] of roleAssignments) {
      await client.query(`insert into membership_roles (id,organization_membership_id,role_id,location_id,assigned_by) values ($1,$2,$3,$4,$5) on conflict (id) do update set role_id=excluded.role_id,location_id=excluded.location_id,archived_at=null`, [stableUuid(`membership-role:${key}`), stableUuid(`membership:${key}`), roleId, locationId, assignedBy]);
    }
    await client.query(`update organization_memberships set status='suspended',suspended_at=coalesce(suspended_at,now()) where id=$1`, [stableUuid("membership:suspended")]);
    await client.query(`update location_memberships set status='suspended' where organization_membership_id=$1`, [stableUuid("membership:suspended")]);

    const profileScopes = [
      [ids.users.admin, ids.organizations.harbor, ids.locations.downtown],
      [ids.users.manager, ids.organizations.harbor, ids.locations.downtown],
      [ids.users.worker, ids.organizations.harbor, ids.locations.downtown],
      [ids.users.volunteer, ids.organizations.harbor, ids.locations.northside],
      [ids.users.viewer, ids.organizations.harbor, ids.locations.downtown],
      [ids.users.suspended, ids.organizations.harbor, ids.locations.downtown],
      [ids.users.unrelated, ids.organizations.unrelated, ids.locations.unrelated],
    ];
    for (const [userId, organizationId, locationId] of profileScopes) {
      await client.query(`update user_profiles set default_organization_id=$2,default_location_id=$3 where id=$1`, [userId, organizationId, locationId]);
    }

    const auditId = stableUuid("audit:seed:harbor");
    const auditExists = await client.query("select 1 from audit_logs where id=$1", [auditId]);
    if (!auditExists.rowCount) {
      await client.query(`insert into audit_logs (id,organization_id,actor_user_id,actor_membership_id,action,entity_type,entity_id,source,request_id,new_values,metadata) values ($1,$2,$3,$4,'seed.foundation','organization',$2,'seed',$5,$6::jsonb,$7::jsonb)`, [auditId, ids.organizations.harbor, ids.users.admin, stableUuid("membership:admin"), randomUUID(), JSON.stringify({ users: people.length, locations: 2 }), JSON.stringify({ fictional: true })]);
    }
    // --- Prompt 3: inventory ledger seed (fictional) ---
    const harbor = ids.organizations.harbor;
    const downtown = ids.locations.downtown;
    const northside = ids.locations.northside;
    const adminUser = ids.users.admin;
    const adminMembership = stableUuid("membership:admin");
    const inv = {
      units: { each: stableUuid("unit:harbor:each"), case: stableUuid("unit:harbor:case"), pound: stableUuid("unit:harbor:pound"), kilogram: stableUuid("unit:harbor:kilogram") },
      categories: { grains: stableUuid("cat:harbor:grains"), canned: stableUuid("cat:harbor:canned"), beverages: stableUuid("cat:harbor:beverages") },
      items: { rice: stableUuid("item:harbor:rice"), beans: stableUuid("item:harbor:beans"), water: stableUuid("item:harbor:water"), soup: stableUuid("item:harbor:soup"), pasta: stableUuid("item:harbor:pasta") },
      storage: { dryA: stableUuid("storage:downtown:dry-a"), cold: stableUuid("storage:downtown:cold"), dryN: stableUuid("storage:northside:dry") },
      lots: { rice: stableUuid("lot:downtown:rice"), beans: stableUuid("lot:downtown:beans"), water: stableUuid("lot:downtown:water"), soup: stableUuid("lot:downtown:soup"), pasta: stableUuid("lot:downtown:pasta"), riceN: stableUuid("lot:northside:rice") },
    };

    for (const [id, name, abbr, dim] of [[inv.units.each, "Each", "ea", "count"], [inv.units.case, "Case", "cs", "count"], [inv.units.pound, "Pound", "lb", "mass"], [inv.units.kilogram, "Kilogram", "kg", "mass"]] as const) {
      await client.query(`insert into units_of_measure (id,organization_id,name,abbreviation,dimension,created_by) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`, [id, harbor, name, abbr, dim, adminUser]);
    }
    for (const [id, name, slug] of [[inv.categories.grains, "Grains", "grains"], [inv.categories.canned, "Canned goods", "canned-goods"], [inv.categories.beverages, "Beverages", "beverages"]] as const) {
      await client.query(`insert into inventory_categories (id,organization_id,name,slug,created_by) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`, [id, harbor, name, slug, adminUser]);
    }
    for (const [id, name, categoryId] of [[inv.items.rice, "Rice (5 lb bag)", inv.categories.grains], [inv.items.beans, "Canned black beans", inv.categories.canned], [inv.items.water, "Bottled water (16 oz)", inv.categories.beverages], [inv.items.soup, "Canned vegetable soup", inv.categories.canned], [inv.items.pasta, "Dry pasta (1 lb)", inv.categories.grains]] as const) {
      await client.query(`insert into inventory_items (id,organization_id,category_id,name,base_unit_id,tracks_expiration,created_by) values ($1,$2,$3,$4,$5,true,$6) on conflict (id) do nothing`, [id, harbor, categoryId, name, inv.units.each, adminUser]);
      await client.query(`insert into inventory_item_units (id,organization_id,inventory_item_id,unit_id,factor,rounding_policy,is_base_unit,is_active,created_by) values ($1,$2,$3,$4,1,'reject',true,true,$5) on conflict (id) do nothing`, [stableUuid(`conv:${id}:each`), harbor, id, inv.units.each, adminUser]);
    }
    for (const [itemId, factor] of [[inv.items.rice, 12], [inv.items.beans, 24], [inv.items.water, 24], [inv.items.pasta, 20]] as const) {
      await client.query(`insert into inventory_item_units (id,organization_id,inventory_item_id,unit_id,factor,rounding_policy,is_base_unit,is_active,created_by) values ($1,$2,$3,$4,$5,'reject',false,true,$6) on conflict (id) do nothing`, [stableUuid(`conv:${itemId}:case`), harbor, itemId, inv.units.case, factor, adminUser]);
    }
    for (const [id, loc, name, code] of [[inv.storage.dryA, downtown, "Dry Storage A", "DS-A"], [inv.storage.cold, downtown, "Cold Room", "COLD"], [inv.storage.dryN, northside, "Dry Storage", "DS"]] as const) {
      await client.query(`insert into storage_locations (id,organization_id,pantry_location_id,name,code,created_by) values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`, [id, harbor, loc, name, code, adminUser]);
    }
    const lotRows = [
      [inv.lots.rice, downtown, inv.items.rice, inv.storage.dryA, "RICE-2607", "current_date - interval '5 days'", "current_date + interval '300 days'"],
      [inv.lots.beans, downtown, inv.items.beans, inv.storage.dryA, "BEAN-2606", "current_date - interval '20 days'", "current_date + interval '400 days'"],
      [inv.lots.water, downtown, inv.items.water, inv.storage.cold, "WATER-2607", "current_date - interval '3 days'", "current_date + interval '540 days'"],
      [inv.lots.soup, downtown, inv.items.soup, inv.storage.dryA, "SOUP-2509", "current_date - interval '200 days'", "current_date - interval '10 days'"],
      [inv.lots.pasta, downtown, inv.items.pasta, inv.storage.dryA, "PASTA-2606", "current_date - interval '15 days'", "current_date + interval '365 days'"],
      [inv.lots.riceN, northside, inv.items.rice, inv.storage.dryN, "RICE-N-2607", "current_date - interval '4 days'", "current_date + interval '300 days'"],
    ] as const;
    for (const [id, loc, itemId, storageId, code, received, expiration] of lotRows) {
      await client.query(`insert into inventory_lots (id,organization_id,pantry_location_id,inventory_item_id,storage_location_id,lot_code,received_date,expiration_date,created_by) values ($1,$2,$3,$4,$5,$6,${received},${expiration},$7) on conflict (id) do nothing`, [id, harbor, loc, itemId, storageId, code, adminUser]);
    }
    async function seedTxn(key: string, lotId: string, itemId: string, loc: string, type: string, delta: string, reasonCode: string | null, reason: string | null, input: string | null, unitId: string | null, factor: string | null, reverses: string | null) {
      await client.query(
        `insert into inventory_transactions (id,organization_id,pantry_location_id,inventory_item_id,inventory_lot_id,transaction_type,physical_delta,input_quantity,input_unit_id,conversion_factor,reason_code,reason,source_type,reverses_transaction_id,actor_user_id,actor_membership_id,request_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'seed',$13,$14,$15,$16) on conflict (id) do nothing`,
        [stableUuid(`txn:${key}`), harbor, loc, itemId, lotId, type, delta, input, unitId, factor, reasonCode, reason, reverses, adminUser, adminMembership, randomUUID()],
      );
    }
    await seedTxn("rice-open", inv.lots.rice, inv.items.rice, downtown, "opening_balance", "48", "opening_balance", "Opening balance during onboarding.", "4", inv.units.case, "12", null);
    await seedTxn("rice-adj", inv.lots.rice, inv.items.rice, downtown, "manual_negative_adjustment", "-6", "missing_inventory", "Six bags unaccounted for at intake.", "6", inv.units.each, "1", null);
    await seedTxn("rice-rev", inv.lots.rice, inv.items.rice, downtown, "reversal", "6", "reversal", "Miscount corrected; bags located.", null, null, null, stableUuid("txn:rice-adj"));
    await seedTxn("beans-open", inv.lots.beans, inv.items.beans, downtown, "opening_balance", "72", "opening_balance", "Opening balance during onboarding.", "3", inv.units.case, "24", null);
    await seedTxn("water-open", inv.lots.water, inv.items.water, downtown, "opening_balance", "48", "opening_balance", "Opening balance during onboarding.", "2", inv.units.case, "24", null);
    await seedTxn("soup-open", inv.lots.soup, inv.items.soup, downtown, "opening_balance", "30", "opening_balance", "Opening balance (now expired lot).", "30", inv.units.each, "1", null);
    await seedTxn("pasta-open", inv.lots.pasta, inv.items.pasta, downtown, "opening_balance", "40", "opening_balance", "Opening balance during onboarding.", "2", inv.units.case, "20", null);
    await seedTxn("rice-n-open", inv.lots.riceN, inv.items.rice, northside, "opening_balance", "24", "opening_balance", "Opening balance during onboarding.", "2", inv.units.case, "12", null);

    // --- Prompt 4: realistic operational records (all fictional) ---
    const anonymousDonor = stableUuid("donor:harbor:anonymous");
    const marketDonor = stableUuid("donor:harbor:market");
    await client.query(`insert into donors (id,organization_id,donor_type,name,is_anonymous_placeholder,created_by) values ($1,$2,'anonymous','Anonymous donor',true,$3) on conflict (id) do nothing`, [anonymousDonor, harbor, adminUser]);
    await client.query(`insert into donors (id,organization_id,donor_type,name,contact_name,email,phone_number,created_by) values ($1,$2,'grocery_store','Harbor Fresh Market','Community Giving Desk','giving@example.test','+1-202-555-0147',$3) on conflict (id) do nothing`, [marketDonor, harbor, adminUser]);

    const donation = stableUuid("donation:harbor:expected");
    await client.query(`insert into donations (id,organization_id,pantry_location_id,donor_id,donation_number,status,donation_date,expected_arrival_at,notes,created_by) values ($1,$2,$3,$4,'DON-DEMO-001','receiving',current_date,now() + interval '2 hours','Fictional grocery rescue pickup.',$5) on conflict (id) do nothing`, [donation, harbor, downtown, marketDonor, adminUser]);
    await client.query(`insert into donation_lines (id,donation_id,organization_id,pantry_location_id,inventory_item_id,expected_quantity,expected_unit_id,notes) values ($1,$2,$3,$4,$5,2,$6,'Expected two cases.') on conflict (id) do nothing`, [stableUuid("donation-line:harbor:expected"), donation, harbor, downtown, inv.items.beans, inv.units.case]);

    const receiving = stableUuid("receiving:harbor:demo");
    await client.query(`insert into receiving_sessions (id,organization_id,pantry_location_id,source_type,donation_id,status,started_by,idempotency_key,notes) values ($1,$2,$3,'donation',$4,'in_progress',$5,$6,'Fictional open receiving session.') on conflict (id) do nothing`, [receiving, harbor, downtown, donation, adminUser, stableUuid("idempotency:receiving:demo")]);
    await client.query(`insert into receiving_lines (id,receiving_session_id,organization_id,pantry_location_id,inventory_item_id,entered_quantity,entered_unit_id,lot_number,received_date,expiration_date,notes) values ($1,$2,$3,$4,$5,1,$6,'BEAN-DEMO-NEXT',current_date,current_date + interval '420 days','Draft line; not yet posted.') on conflict (id) do nothing`, [stableUuid("receiving-line:harbor:demo"), receiving, harbor, downtown, inv.items.beans, inv.units.case]);

    await client.query(`insert into adjustment_requests (id,organization_id,pantry_location_id,inventory_item_id,inventory_lot_id,direction,entered_quantity,entered_unit_id,resolved_conversion_factor,normalized_base_quantity,risk,status,reason_code,reason,requested_by,idempotency_key) values ($1,$2,$3,$4,$5,'negative',30,$6,1,30,'high','submitted','cycle_count_variance','Fictional high-impact variance awaiting a separate approver.',$7,$8) on conflict (id) do nothing`, [stableUuid("adjustment:harbor:pending"), harbor, downtown, inv.items.beans, inv.lots.beans, inv.units.each, ids.users.worker, stableUuid("idempotency:adjustment:demo")]);

    const transfer = stableUuid("transfer:harbor:draft");
    await client.query(`insert into inventory_transfers (id,organization_id,transfer_number,source_location_id,destination_location_id,status,requested_by,idempotency_key,notes) values ($1,$2,'TR-DEMO-001',$3,$4,'draft',$5,$6,'Fictional replenishment draft.') on conflict (id) do nothing`, [transfer, harbor, downtown, northside, ids.users.manager, stableUuid("idempotency:transfer:demo")]);
    await client.query(`insert into inventory_transfer_lines (id,transfer_id,organization_id,inventory_item_id,source_lot_id,requested_quantity,requested_unit_id,resolved_conversion_factor,requested_base_quantity) values ($1,$2,$3,$4,$5,6,$6,1,6) on conflict (id) do nothing`, [stableUuid("transfer-line:harbor:draft"), transfer, harbor, inv.items.rice, inv.lots.rice, inv.units.each]);

    // --- Prompt 5: fictional household and pickup setup (no SMS is sent) ---
    const household = stableUuid("household:harbor:rivera");
    const packageTemplate = stableUuid("package:harbor:standard");
    const appointment = stableUuid("appointment:harbor:rivera-next");
    await client.query(`insert into households (id,organization_id,household_number,status,display_name,preferred_language,household_size,adult_count,child_count,default_pantry_location_id,operational_notes,created_by) values ($1,$2,'H-DEMO-001','active','Rivera household','en',3,2,1,$3,'Fictional development household.',$4) on conflict (id) do nothing`, [household, harbor, downtown, adminUser]);
    await client.query(`insert into household_contacts (id,organization_id,household_id,contact_type,name,phone_number,phone_normalized,email,is_authorized_pickup,created_by) values ($1,$2,$3,'primary','Jordan Rivera','+1-202-555-0199','2025550199','jordan.rivera@example.test',true,$4) on conflict (id) do nothing`, [stableUuid("household-contact:harbor:rivera"), harbor, household, adminUser]);
    await client.query(`insert into household_preferences (id,organization_id,household_id,preference_type,value_code,display_label,severity,created_by) values ($1,$2,$3,'dietary','vegetarian','Vegetarian preference','info',$4) on conflict (id) do nothing`, [stableUuid("household-preference:harbor:rivera"), harbor, household, adminUser]);
    await client.query(`insert into sms_consents (id,organization_id,household_id,household_contact_id,phone_normalized,status,consent_source,recorded_by,notes) values ($1,$2,$3,$4,'2025550199','consented','paper_form',$5,'Fictional local development consent; no SMS is sent.') on conflict (id) do nothing`, [stableUuid("sms-consent:harbor:rivera"), harbor, household, stableUuid("household-contact:harbor:rivera"), adminUser]);
    await client.query(`insert into pickup_package_templates (id,organization_id,pantry_location_id,name,description,package_type,allow_substitutions,created_by) values ($1,$2,$3,'Standard family pickup','Fictional family pickup template.','standard_family',true,$4) on conflict (id) do nothing`, [packageTemplate, harbor, downtown, adminUser]);
    await client.query(`insert into pickup_package_template_lines (id,package_template_id,organization_id,inventory_item_id,line_type,base_quantity,is_required,allow_substitution,priority) values ($1,$2,$3,$4,'exact_item',2,true,true,1) on conflict (id) do nothing`, [stableUuid("package-line:harbor:standard-rice"), packageTemplate, harbor, inv.items.rice]);
    await client.query(`insert into household_size_package_rules (id,organization_id,package_template_id,minimum_household_size,maximum_household_size,quantity_multiplier,created_by) values ($1,$2,$3,1,4,1,$4) on conflict (id) do nothing`, [stableUuid("package-rule:harbor:standard-small"), harbor, packageTemplate, adminUser]);
    await client.query(`insert into appointments (id,organization_id,pantry_location_id,household_id,appointment_number,appointment_type,status,scheduled_start_at,scheduled_end_at,package_template_id,household_size_snapshot,preferred_language_snapshot,created_by) values ($1,$2,$3,$4,'APT-DEMO-001','scheduled_pickup','scheduled',date_trunc('day',now()) + interval '1 day 10 hours',date_trunc('day',now()) + interval '1 day 10 hours 30 minutes',$5,3,'en',$6) on conflict (id) do nothing`, [appointment, harbor, downtown, household, packageTemplate, adminUser]);
    await client.query(`insert into appointment_status_history (id,organization_id,pantry_location_id,appointment_id,to_status,reason,changed_by) values ($1,$2,$3,$4,'scheduled','Fictional development appointment.',$5) on conflict (id) do nothing`, [stableUuid("appointment-history:harbor:rivera-next"), harbor, downtown, appointment, adminUser]);

    // --- Prompt 6: deterministic forecast configuration and operating calendars ---
    await client.query(`insert into forecast_configurations(id,organization_id,scope_type,lookback_7_day_weight,lookback_30_day_weight,lookback_90_day_weight,minimum_history_days,safety_stock_method,safety_stock_days,lead_time_days,forecast_horizon_days,shortage_warning_days,urgent_shortage_days,demand_spike_threshold,created_by) values($1,$2,'organization_default',0.5,0.3,0.2,7,'days',2,3,30,7,3,1.5,$3) on conflict(id) do nothing`,[stableUuid("forecast-config:harbor:default"),harbor,adminUser]);
    for(const locationId of [downtown,northside]) for(const day of [1,2,3,4,5]) await client.query(`insert into pantry_operating_calendars(id,organization_id,pantry_location_id,day_of_week,is_open,opens_at,closes_at,effective_from,created_by) values($1,$2,$3,$4,true,'09:00','16:00',current_date-interval '1 year',$5) on conflict(id) do nothing`,[stableUuid(`forecast-calendar:${locationId}:${day}`),harbor,locationId,day,adminUser]);
    for(const [itemId,categoryId,factor] of [[inv.items.rice,inv.categories.grains,1],[inv.items.pasta,inv.categories.grains,1],[inv.items.beans,inv.categories.canned,2],[inv.items.soup,inv.categories.canned,2],[inv.items.water,inv.categories.beverages,1]] as const) await client.query(`insert into category_item_equivalencies(id,organization_id,inventory_category_id,inventory_item_id,base_quantity_per_service_unit,created_by) values($1,$2,$3,$4,$5,$6) on conflict(id) do nothing`,[stableUuid(`forecast-equivalency:${itemId}`),harbor,categoryId,itemId,factor,adminUser]);

    // --- Prompt 7: simulation-only messaging, controlled assistant, and export audit demos ---
    const smsTemplate=stableUuid("message-template:harbor:reminder");
    const smsCampaign=stableUuid("message-campaign:harbor:demo");
    const smsMessage=stableUuid("sms-message:harbor:demo");
    await client.query(`insert into sms_settings(id,organization_id,pantry_location_id,provider,sending_mode,default_language,reminder_hours_before,retry_limit,is_enabled,created_by) values($1,$2,$3,'simulation','simulation','en',24,3,true,$4) on conflict(id) do nothing`,[stableUuid("sms-settings:harbor:downtown"),harbor,downtown,adminUser]);
    await client.query(`insert into message_templates(id,organization_id,pantry_location_id,name,template_type,language,body,status,variables,is_system_template,created_by) values($1,$2,$3,'Appointment reminder','appointment_reminder','en','Reminder: your pickup at {{location_name}} is {{appointment_time}}. Reply C to confirm or STOP to opt out.','active','["location_name","appointment_time"]',true,$4) on conflict(id) do nothing`,[smsTemplate,harbor,downtown,adminUser]);
    await client.query(`insert into message_campaigns(id,organization_id,pantry_location_id,name,campaign_type,status,template_id,audience_definition,message_body_snapshot,approved_by,approved_at,created_by,idempotency_key) values($1,$2,$3,'Fictional reminder campaign','appointment_reminder','sent',$4,'{"appointment":"APT-DEMO-001"}','Reminder: your pickup is tomorrow.',$5,now(),$5,$6) on conflict(id) do nothing`,[smsCampaign,harbor,downtown,smsTemplate,adminUser,stableUuid("campaign-idempotency:harbor:demo")]);
    await client.query(`insert into sms_messages(id,organization_id,pantry_location_id,campaign_id,appointment_id,household_id,household_contact_id,consent_id,direction,message_type,status,to_phone_number,body_snapshot,language,queued_at,sent_at,delivered_at,provider,provider_message_id,attempt_count,idempotency_key,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,'outbound','appointment_reminder','delivered','2025550199','Reminder: your pickup is tomorrow.','en',now()-interval '5 minutes',now()-interval '4 minutes',now()-interval '3 minutes','simulation','SIM-DEMO-001',1,$9,$10) on conflict(id) do nothing`,[smsMessage,harbor,downtown,smsCampaign,appointment,household,stableUuid("household-contact:harbor:rivera"),stableUuid("sms-consent:harbor:rivera"),stableUuid("sms-idempotency:harbor:demo"),adminUser]);
    await client.query(`insert into sms_events(id,organization_id,pantry_location_id,sms_message_id,provider_event_id,event_type,provider_status,payload_snapshot) values($1,$2,$3,$4,'SIM-EVENT-DEMO-001','delivery','delivered','{"simulated":true}') on conflict(id) do nothing`,[stableUuid("sms-event:harbor:demo"),harbor,downtown,smsMessage]);
    await client.query(`insert into inbound_messages(id,organization_id,pantry_location_id,household_id,household_contact_id,from_phone_number,to_phone_number,body,normalized_command,provider_message_id,processing_status,created_at) values($1,$2,$3,$4,$5,'2025550199','2025550100','STOP','STOP','SIM-INBOUND-DEMO-001','processed',now()-interval '2 minutes') on conflict(id) do nothing`,[stableUuid("inbound-message:harbor:stop-demo"),harbor,downtown,household,stableUuid("household-contact:harbor:rivera")]);
    const conversation=stableUuid("ai-conversation:harbor:demo");
    await client.query(`insert into ai_conversations(id,organization_id,pantry_location_id,user_id,title,status) values($1,$2,$3,$4,'Fictional shortage review','active') on conflict(id) do nothing`,[conversation,harbor,downtown,adminUser]);
    await client.query(`insert into ai_messages(id,conversation_id,organization_id,role,content,model) values($1,$2,$3,'user','Which items have an urgent shortage?',null),($4,$2,$3,'assistant','AI is disabled locally. Use the deterministic forecast tool results shown in the app.',null) on conflict(id) do nothing`,[stableUuid("ai-message:harbor:user-demo"),conversation,harbor,stableUuid("ai-message:harbor:assistant-demo")]);
    await client.query(`insert into ai_action_proposals(id,conversation_id,organization_id,pantry_location_id,proposed_by,action_type,payload_snapshot,state_fingerprint,risk_level,status,expires_at,idempotency_key,rejection_reason) values($1,$2,$3,$4,$5,'appointment_reschedule','{}','demo-stale-state','high','rejected',now()+interval '1 hour',$6,'Fictional rejected proposal; no action executed.') on conflict(id) do nothing`,[stableUuid("ai-proposal:harbor:demo"),conversation,harbor,downtown,adminUser,stableUuid("ai-proposal-idempotency:harbor:demo")]);
    await client.query(`insert into report_exports(id,organization_id,pantry_location_id,report_type,format,date_from,date_to,filters,row_count,generated_by,request_id) values($1,$2,$3,'weekly_operations','csv',current_date-7,current_date,'{}',0,$4,$5) on conflict(id) do nothing`,[stableUuid("report-export:harbor:demo"),harbor,downtown,adminUser,randomUUID()]);

    await client.query("commit");
    console.log(`seeded:${parsed.pathname.slice(1)}:users=${people.length}:organizations=2:locations=3:items=5:lots=6:donors=2:operations=4`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

seed().catch((error) => {
  console.error(error instanceof Error ? error.message : "Seed failed.");
  process.exitCode = 1;
});
