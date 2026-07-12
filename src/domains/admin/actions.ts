"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionResult } from "@/lib/action-result";
import { getOrganizationAccessList, requireOrganizationContext, requireUser, verifyLocationPermission, verifyOrganizationPermission, type PermissionKey } from "@/lib/auth/access";
import { getServerEnvironment } from "@/lib/env";
import { logServerError, mapProviderError } from "@/lib/errors";
import { safeNextPath } from "@/domains/auth/schemas";
import {
  invitationSchema,
  locationAssignmentSchema,
  locationSchema,
  organizationSettingsSchema,
  profileSchema,
  roleAssignmentSchema,
} from "@/domains/admin/schemas";
import {
  acceptInvitation,
  archiveLocation,
  assignMemberLocation,
  assignMemberRole,
  changeMembershipStatus,
  createLocation,
  prepareInvitation,
  removeMemberLocation,
  removeMemberRole,
  revokeInvitation,
  setActiveScope,
  updateLocation,
  updateOrganization,
  updateOwnProfile,
} from "@/domains/admin/service";

function validationFailure(requestId: string, message = "Review the entered information."): ActionResult {
  return { ok: false, code: "VALIDATION_ERROR", message, requestId };
}

function serviceFailure(scope: string, requestId: string, error: unknown) {
  const providerError = error instanceof Error ? { message: error.message, code: (error as { code?: string }).code } : {};
  logServerError(scope, requestId, providerError);
  return mapProviderError(providerError, requestId);
}

async function authorized(organizationId: string, permission: PermissionKey, requestId: string): Promise<ActionResult | null> {
  if (await verifyOrganizationPermission(organizationId, permission)) return null;
  return { ok: false, code: "FORBIDDEN", message: "You do not have permission to perform this action.", requestId };
}

export async function updateOwnProfileAction(_: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try { await updateOwnProfile(currentUser.id, parsed.data); } catch (error) { return serviceFailure("profile.update", requestId, error); }
  revalidatePath("/profile");
  return { ok: true, data: undefined, message: "Profile updated.", requestId };
}

export async function switchOrganizationAction(formData: FormData) {
  const currentUser = await requireUser();
  const organizationId = String(formData.get("organizationId") ?? "");
  const access = (await getOrganizationAccessList()).find((item) => item.organization.id === organizationId);
  if (!access) redirect("/");
  try { await setActiveScope(currentUser.id, organizationId, access.locations[0]?.id ?? null); } catch { redirect("/"); }
  redirect(`/app/${access.organization.slug}/dashboard`);
}

export async function switchLocationAction(organizationSlug: string, formData: FormData) {
  const currentUser = await requireUser();
  const context = await requireOrganizationContext(organizationSlug);
  const locationId = String(formData.get("locationId") ?? "");
  const location = context.access.locations.find((item) => item.id === locationId);
  if (!location) redirect(`/app/${organizationSlug}/dashboard`);
  try { await setActiveScope(currentUser.id, context.access.organization.id, location.id); } catch { redirect(`/app/${organizationSlug}/dashboard`); }
  const returnTo = safeNextPath(String(formData.get("returnTo") ?? ""), `/app/${organizationSlug}/dashboard`);
  revalidatePath(`/app/${organizationSlug}`);
  redirect(returnTo.startsWith(`/app/${organizationSlug}/`) ? returnTo : `/app/${organizationSlug}/dashboard`);
}

export async function updateOrganizationAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  const denied = await authorized(organizationId, "organization.update", requestId);
  if (denied) return denied;
  const parsed = organizationSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try { await updateOrganization(currentUser.id, organizationId, parsed.data, requestId); } catch (error) { return serviceFailure("organization.update", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/settings`);
  return { ok: true, data: undefined, message: "Organization settings updated.", requestId };
}

export async function createLocationAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  const denied = await authorized(organizationId, "location.create", requestId);
  if (denied) return denied;
  const parsed = locationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || !parsed.data.slug) return validationFailure(requestId);
  try { await createLocation(currentUser.id, organizationId, { ...parsed.data, slug: parsed.data.slug }, requestId); } catch (error) { return serviceFailure("location.create", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/locations`);
  return { ok: true, data: undefined, message: "Location created.", requestId };
}

export async function updateLocationAction(locationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  if (!(await verifyLocationPermission(locationId, "location.update"))) return { ok: false, code: "FORBIDDEN", message: "You do not have permission to update this location.", requestId };
  const parsed = locationSchema.omit({ slug: true }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try { await updateLocation(currentUser.id, locationId, parsed.data, requestId); } catch (error) { return serviceFailure("location.update", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/locations`);
  return { ok: true, data: undefined, message: "Location updated.", requestId };
}

export async function archiveLocationAction(locationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  if (formData.get("confirm") !== "archive") return validationFailure(requestId, "Confirm location archival before continuing.");
  try { await archiveLocation(currentUser.id, locationId, String(formData.get("reason") ?? "Administrative archival"), requestId); } catch (error) { return serviceFailure("location.archive", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/locations`);
  return { ok: true, data: undefined, message: "Location archived.", requestId };
}

export async function prepareInvitationAction(organizationId: string, organizationSlug: string, _: ActionResult<{ acceptanceUrl: string } | undefined>, formData: FormData): Promise<ActionResult<{ acceptanceUrl: string }>> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  const denied = await authorized(organizationId, "member.invite", requestId);
  if (denied) return denied as ActionResult<{ acceptanceUrl: string }>;
  const parsed = invitationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId) as ActionResult<{ acceptanceUrl: string }>;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try { await prepareInvitation(currentUser.id, organizationId, parsed.data.email, parsed.data.roleId, parsed.data.locationId || null, tokenHash, expiresAt, requestId); } catch (error) { return serviceFailure("invitation.prepare", requestId, error) as ActionResult<{ acceptanceUrl: string }>; }
  revalidatePath(`/app/${organizationSlug}/team`);
  return { ok: true, data: { acceptanceUrl: `${getServerEnvironment().APP_URL}/invitations/accept?token=${token}` }, message: "Invitation prepared. Share the secure link through an approved channel.", requestId };
}

export async function revokeInvitationAction(organizationId: string, organizationSlug: string, invitationId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  const denied = await authorized(organizationId, "member.invite", requestId);
  if (denied) return denied;
  try { await revokeInvitation(currentUser.id, organizationId, invitationId, String(formData.get("reason") ?? "Revoked by administrator"), requestId); } catch (error) { return serviceFailure("invitation.revoke", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/team`);
  return { ok: true, data: undefined, message: "Invitation revoked.", requestId };
}

export async function assignRoleAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  const denied = await authorized(organizationId, "role.assign", requestId);
  if (denied) return denied;
  const parsed = roleAssignmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try { await assignMemberRole(currentUser.id, organizationId, parsed.data.membershipId, parsed.data.roleId, parsed.data.locationId || null, parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null, requestId); } catch (error) { return serviceFailure("role.assign", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/team`);
  return { ok: true, data: undefined, message: "Role assigned.", requestId };
}

export async function removeRoleAction(organizationId: string, organizationSlug: string, assignmentId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  const denied = await authorized(organizationId, "role.assign", requestId);
  if (denied) return denied;
  try { await removeMemberRole(currentUser.id, organizationId, assignmentId, String(formData.get("reason") ?? "Removed by administrator"), requestId); } catch (error) { return serviceFailure("role.remove", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/team`);
  return { ok: true, data: undefined, message: "Role removed.", requestId };
}

export async function assignLocationAction(organizationId: string, organizationSlug: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  const denied = await authorized(organizationId, "member.update", requestId);
  if (denied) return denied;
  const parsed = locationAssignmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try { await assignMemberLocation(currentUser.id, organizationId, parsed.data.membershipId, parsed.data.locationId, requestId); } catch (error) { return serviceFailure("location_membership.assign", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/team`);
  return { ok: true, data: undefined, message: "Location assigned.", requestId };
}

export async function removeLocationAssignmentAction(organizationId: string, organizationSlug: string, membershipId: string, locationId: string, _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  const denied = await authorized(organizationId, "member.update", requestId);
  if (denied) return denied;
  try { await removeMemberLocation(currentUser.id, organizationId, membershipId, locationId, String(formData.get("reason") ?? "Removed by administrator"), requestId); } catch (error) { return serviceFailure("location_membership.remove", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/team`);
  return { ok: true, data: undefined, message: "Location assignment removed.", requestId };
}

export async function changeMembershipStatusAction(organizationId: string, organizationSlug: string, membershipId: string, status: "active" | "suspended" | "archived", _: ActionResult, formData: FormData): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  const permission: PermissionKey = status === "suspended" ? "member.suspend" : status === "archived" ? "member.archive" : "member.update";
  const denied = await authorized(organizationId, permission, requestId);
  if (denied) return denied;
  try { await changeMembershipStatus(currentUser.id, organizationId, membershipId, status, String(formData.get("reason") ?? "Changed by administrator"), requestId); } catch (error) { return serviceFailure("membership.status", requestId, error); }
  revalidatePath(`/app/${organizationSlug}/team`);
  return { ok: true, data: undefined, message: `Membership ${status}.`, requestId };
}

export async function acceptInvitationAction(token: string, previousState: ActionResult): Promise<ActionResult> {
  void previousState;
  const requestId = crypto.randomUUID();
  const currentUser = await requireUser();
  if (!token || token.length > 200) return { ok: false, code: "NOT_FOUND", message: "This invitation is invalid or has expired.", requestId };
  const tokenHash = createHash("sha256").update(token).digest("hex");
  let result: Awaited<ReturnType<typeof acceptInvitation>>;
  try { result = await acceptInvitation(currentUser.id, currentUser.email, tokenHash, requestId); } catch (error) { return serviceFailure("invitation.accept", requestId, error); }
  const access = (await getOrganizationAccessList()).find((item) => item.organization.id === result.organizationId);
  if (access) redirect(`/app/${access.organization.slug}/dashboard`);
  redirect("/");
}
