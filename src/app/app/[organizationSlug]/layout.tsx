import { AppShell } from "@/components/shell/app-shell";
import { requireOrganizationContext } from "@/lib/auth/access";

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireOrganizationContext(organizationSlug);
  return (
    <AppShell
      access={context.access}
      accessList={context.accessList}
      profile={context.profile}
      activeLocationId={context.activeLocation?.id ?? null}
      permissions={context.effectivePermissions}
    >
      {children}
    </AppShell>
  );
}
