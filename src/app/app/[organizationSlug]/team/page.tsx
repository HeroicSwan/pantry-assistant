import { notFound } from "next/navigation";
import { InvitationForm } from "@/components/team/invitation-form";
import { ActionForm } from "@/components/ui/action-form";
import { Field, SelectField } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  assignLocationAction,
  assignRoleAction,
  changeMembershipStatusAction,
  createCustomRoleAction,
  prepareInvitationAction,
  removeLocationAssignmentAction,
  removeRoleAction,
  revokeInvitationAction,
} from "@/domains/admin/actions";
import { can, requireOrganizationContext } from "@/lib/auth/access";
import { getTeamDataForUser } from "@/domains/admin/queries";

type MemberRow = {
  id: string;
  user_id: string;
  status: string;
  all_locations: boolean;
  joined_at: string | null;
};
type ProfileRow = { id: string; display_name: string; email: string };
type RoleRow = {
  id: string;
  name: string;
  slug: string;
  scope: "organization" | "location";
};
type AssignmentRow = {
  id: string;
  organization_membership_id: string;
  location_id: string | null;
  expires_at: string | null;
  role: RoleRow | null;
};
type LocationAssignmentRow = {
  organization_membership_id: string;
  location_id: string;
  status: string;
};
type InvitationRow = {
  id: string;
  email: string;
  status: string;
  expires_at: string;
  role: { name: string } | null;
  location: { name: string } | null;
};

export default async function TeamPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  if (!can(context.effectivePermissions, "member.view")) notFound();
  const organizationId = context.access.organization.id;
  const teamData = await getTeamDataForUser(context.user.id, organizationId);
  if (!teamData) notFound();
  const members = teamData.members as MemberRow[];
  const profiles = teamData.profiles as ProfileRow[];
  const roles = teamData.roles as RoleRow[];
  const assignments = teamData.assignments as AssignmentRow[];
  const locationAssignments = teamData.locationAssignments as LocationAssignmentRow[];
  const invitations = teamData.invitations as InvitationRow[];
  const mayInvite = can(context.effectivePermissions, "member.invite");
  const mayAssignRoles = can(context.effectivePermissions, "role.assign");
  const mayManageRoles = can(context.effectivePermissions, "role.manage");
  const mayUpdateMembers = can(context.effectivePermissions, "member.update");

  return (
    <div className="grid gap-10">
      <PageHeader
        eyebrow="Team"
        title="Members and access"
        description="Membership status, organization roles, location assignments, and invitations. Every change is reauthorized by the server and database."
      />
      {mayInvite ? (
        <InvitationForm
          action={prepareInvitationAction.bind(
            null,
            organizationId,
            organizationSlug,
          )}
          roles={roles}
          locations={context.access.locations}
        />
      ) : null}
      {mayManageRoles ? (
        <section className="grid gap-4 border border-[var(--rule)] bg-white p-5">
          <div>
            <h2 className="text-2xl font-semibold">Custom roles</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">Create an organization role from the permission catalog. Use a comma- or space-separated permission list.</p>
          </div>
          <ActionForm action={createCustomRoleAction.bind(null, organizationId, organizationSlug)} className="grid gap-3 md:grid-cols-2">
            <Field label="Name" name="name" required />
            <Field label="Slug" name="slug" placeholder="food-coordinator" required />
            <Field label="Description" name="description" required />
            <SelectField label="Scope" name="scope" defaultValue="organization"><option value="organization">Organization-wide</option><option value="location">Location-specific</option></SelectField>
            <Field label="Permission keys" name="permissionKeys" placeholder="inventory.view, household.view_basic" required />
            <div className="flex items-end"><SubmitButton>Create custom role</SubmitButton></div>
          </ActionForm>
        </section>
      ) : null}
      {invitations.some((invitation) => invitation.status === "pending") ? (
        <section className="grid gap-3">
          <h2 className="text-2xl font-semibold">Pending invitations</h2>
          {invitations
            .filter((invitation) => invitation.status === "pending")
            .map((invitation) => (
              <article
                key={invitation.id}
                className="grid gap-4 border border-[var(--rule)] bg-white p-5 md:grid-cols-[1fr_auto] md:items-center"
              >
                <div>
                  <p className="font-semibold">{invitation.email}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {invitation.role?.name}
                    {invitation.location
                      ? ` · ${invitation.location.name}`
                      : " · organization-wide"}{" "}
                    · expires{" "}
                    {new Date(invitation.expires_at).toLocaleDateString()}
                  </p>
                </div>
                {mayInvite ? (
                  <ActionForm
                    action={revokeInvitationAction.bind(
                      null,
                      organizationId,
                      organizationSlug,
                      invitation.id,
                    )}
                    className="flex items-end gap-2"
                  >
                    <Field
                      label="Reason"
                      name="reason"
                      defaultValue="Invitation revoked"
                    />
                    <SubmitButton variant="danger">Revoke</SubmitButton>
                  </ActionForm>
                ) : null}
              </article>
            ))}
        </section>
      ) : null}
      <section className="grid gap-4">
        <h2 className="text-2xl font-semibold">Current members</h2>
        {members.map((member) => {
          const profile = profiles.find((item) => item.id === member.user_id);
          const memberRoles = assignments.filter(
            (item) => item.organization_membership_id === member.id,
          );
          const memberLocations = locationAssignments.filter(
            (item) => item.organization_membership_id === member.id,
          );
          return (
            <article
              key={member.id}
              className="border border-[var(--rule)] bg-white"
            >
              <header className="grid gap-3 border-b border-[var(--rule)] p-5 md:grid-cols-[1fr_auto]">
                <div>
                  <h3 className="text-xl font-semibold">
                    {profile?.display_name ?? "Account profile unavailable"}
                  </h3>
                  <p className="text-sm text-[var(--muted)]">
                    {profile?.email ?? "Email unavailable"}
                  </p>
                </div>
                <StatusBadge status={member.status} />
              </header>
              <div className="grid gap-6 p-5 lg:grid-cols-2">
                <div>
                  <h4 className="text-sm font-semibold">Roles</h4>
                  <ul className="mt-3 grid gap-2">
                    {memberRoles.length ? (
                      memberRoles.map((assignment) => (
                        <li
                          key={assignment.id}
                          className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--rule)] pb-2 text-sm"
                        >
                          <span>
                            {assignment.role?.name}
                            {assignment.location_id
                              ? ` · ${context.access.locations.find((item) => item.id === assignment.location_id)?.name ?? "Location"}`
                              : " · organization-wide"}
                          </span>
                          {mayAssignRoles ? (
                            <ActionForm
                              action={removeRoleAction.bind(
                                null,
                                organizationId,
                                organizationSlug,
                                assignment.id,
                              )}
                              className="flex gap-2"
                            >
                              <input
                                type="hidden"
                                name="reason"
                                value="Removed by administrator"
                              />
                              <SubmitButton variant="danger">
                                Remove
                              </SubmitButton>
                            </ActionForm>
                          ) : null}
                        </li>
                      ))
                    ) : (
                      <li className="text-sm text-[var(--muted)]">
                        No active role assignments.
                      </li>
                    )}
                  </ul>
                  {mayAssignRoles && member.status === "active" ? (
                    <ActionForm
                      action={assignRoleAction.bind(
                        null,
                        organizationId,
                        organizationSlug,
                      )}
                      className="mt-4 grid gap-3 border-l-4 border-[var(--rule)] pl-4"
                    >
                      <input
                        type="hidden"
                        name="membershipId"
                        value={member.id}
                      />
                      <SelectField label="Assign role" name="roleId" required>
                        <option value="">Select role</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name} · {role.scope}
                          </option>
                        ))}
                      </SelectField>
                      <SelectField label="Role location" name="locationId">
                        <option value="">Organization-wide</option>
                        {memberLocations.map((assignment) => {
                          const location = context.access.locations.find(
                            (item) => item.id === assignment.location_id,
                          );
                          return location ? (
                            <option key={location.id} value={location.id}>
                              {location.name}
                            </option>
                          ) : null;
                        })}
                      </SelectField>
                      <input type="hidden" name="expiresAt" value="" />
                      <SubmitButton>Assign role</SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
                <div>
                  <h4 className="text-sm font-semibold">Locations</h4>
                  <ul className="mt-3 grid gap-2">
                    {member.all_locations ? (
                      <li className="text-sm">
                        All locations through organization role
                      </li>
                    ) : (
                      memberLocations.map((assignment) => {
                        const location = context.access.locations.find(
                          (item) => item.id === assignment.location_id,
                        );
                        return (
                          <li
                            key={assignment.location_id}
                            className="flex items-center justify-between gap-2 border-b border-[var(--rule)] pb-2 text-sm"
                          >
                            <span>{location?.name ?? "Archived location"}</span>
                            {mayUpdateMembers ? (
                              <ActionForm
                                action={removeLocationAssignmentAction.bind(
                                  null,
                                  organizationId,
                                  organizationSlug,
                                  member.id,
                                  assignment.location_id,
                                )}
                                className="flex"
                              >
                                <input
                                  type="hidden"
                                  name="reason"
                                  value="Removed by administrator"
                                />
                                <SubmitButton variant="danger">
                                  Remove
                                </SubmitButton>
                              </ActionForm>
                            ) : null}
                          </li>
                        );
                      })
                    )}
                  </ul>
                  {mayUpdateMembers && member.status === "active" ? (
                    <ActionForm
                      action={assignLocationAction.bind(
                        null,
                        organizationId,
                        organizationSlug,
                      )}
                      className="mt-4 grid gap-3 border-l-4 border-[var(--rule)] pl-4"
                    >
                      <input
                        type="hidden"
                        name="membershipId"
                        value={member.id}
                      />
                      <SelectField
                        label="Assign location"
                        name="locationId"
                        required
                      >
                        <option value="">Select location</option>
                        {context.access.locations
                          .filter(
                            (location) =>
                              !memberLocations.some(
                                (item) => item.location_id === location.id,
                              ),
                          )
                          .map((location) => (
                            <option key={location.id} value={location.id}>
                              {location.name}
                            </option>
                          ))}
                      </SelectField>
                      <SubmitButton>Assign location</SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              </div>
              {member.status === "active" &&
              (can(context.effectivePermissions, "member.suspend") ||
                can(context.effectivePermissions, "member.archive")) ? (
                <footer className="flex flex-wrap gap-3 border-t border-[var(--rule)] p-5">
                  {can(context.effectivePermissions, "member.suspend") ? (
                    <ActionForm
                      action={changeMembershipStatusAction.bind(
                        null,
                        organizationId,
                        organizationSlug,
                        member.id,
                        "suspended",
                      )}
                      className="flex gap-2"
                    >
                      <Field label="Suspension reason" name="reason" required />
                      <SubmitButton variant="danger">Suspend</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {can(context.effectivePermissions, "member.archive") ? (
                    <ActionForm
                      action={changeMembershipStatusAction.bind(
                        null,
                        organizationId,
                        organizationSlug,
                        member.id,
                        "archived",
                      )}
                      className="flex gap-2"
                    >
                      <Field label="Archive reason" name="reason" required />
                      <SubmitButton variant="danger">Archive</SubmitButton>
                    </ActionForm>
                  ) : null}
                </footer>
              ) : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}
