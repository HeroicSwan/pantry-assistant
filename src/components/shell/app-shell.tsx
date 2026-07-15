import Link from "next/link";
import {
  Boxes,
  CalendarDays,
  ChartNoAxesCombined,
  BellRing,
  Bot,
  FileChartColumn,
  MessageSquareText,
  ClipboardList,
  House,
  MapPin,
  Menu,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { ScopeSwitchers } from "@/components/shell/scope-switchers";
import { signOutAction } from "@/domains/auth/actions";
import {
  can,
  type OrganizationAccess,
  type PermissionKey,
  type Profile,
} from "@/lib/auth/access";

type ShellProps = {
  access: OrganizationAccess;
  accessList: OrganizationAccess[];
  profile: Profile | null;
  activeLocationId: string | null;
  permissions: ReadonlySet<PermissionKey>;
  children: React.ReactNode;
};

export function AppShell({
  access,
  accessList,
  profile,
  activeLocationId,
  permissions,
  children,
}: ShellProps) {
  const base = `/app/${access.organization.slug}`;
  const links = [
    { href: `${base}/dashboard`, label: "Dashboard", icon: House, show: true },
    {
      href: `${base}/inventory`,
      label: "Inventory",
      icon: Boxes,
      show: can(permissions, "inventory.view"),
    },
    {
      href: `${base}/pickups`,
      label: "Pickups",
      icon: CalendarDays,
      show: can(permissions, "appointment.view"),
    },
    {
      href: `${base}/forecast`,
      label: "Forecast",
      icon: ChartNoAxesCombined,
      show: can(permissions, "forecast.view"),
    },
    {
      href: `${base}/alerts`,
      label: "Alerts",
      icon: BellRing,
      show: can(permissions, "alert.view"),
    },
    {
      href: `${base}/messages`,
      label: "Messaging",
      icon: MessageSquareText,
      show: can(permissions, "message.view"),
    },
    {
      href: `${base}/assistant`,
      label: "Assistant",
      icon: Bot,
      show: can(permissions, "assistant.use"),
    },
    {
      href: `${base}/reports`,
      label: "Reports",
      icon: FileChartColumn,
      show: can(permissions, "report.view"),
    },
    {
      href: `${base}/locations`,
      label: "Locations",
      icon: MapPin,
      show: can(permissions, "location.view"),
    },
    {
      href: `${base}/team`,
      label: "Team",
      icon: UsersRound,
      show: can(permissions, "member.view"),
    },
    {
      href: `${base}/settings`,
      label: "Organization",
      icon: Settings,
      show: can(permissions, "organization.update"),
    },
    {
      href: `${base}/audit`,
      label: "Audit log",
      icon: ShieldCheck,
      show: can(permissions, "audit.view"),
    },
    { href: "/profile", label: "Profile", icon: UserRound, show: true },
  ].filter((item) => item.show);

  const navigation = (
    <nav aria-label="Primary" className="grid gap-1">
      {links.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="flex min-h-11 items-center gap-3 border border-transparent px-3 text-sm font-semibold hover:border-[var(--rule)] hover:bg-white"
        >
          <Icon size={18} aria-hidden />
          {label}
        </Link>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[300px_1fr]">
      <aside className="hidden border-r border-[var(--rule)] bg-[var(--surface)] p-5 lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <Link
          href={base}
          className="border-b border-[var(--ink)] pb-5 text-lg font-bold tracking-[-0.03em]"
        >
          Pantry Assistant
        </Link>
        <div className="mt-5">
          <ScopeSwitchers
            organizationId={access.organization.id}
            organizationSlug={access.organization.slug}
            organizations={accessList.map((item) => item.organization)}
            locationId={activeLocationId}
            locations={access.locations}
          />
        </div>
        <div className="mt-6 flex-1">{navigation}</div>
        <div className="border-t border-[var(--rule)] pt-4">
          <p className="truncate text-sm font-semibold">
            {profile?.displayName}
          </p>
          <p className="truncate text-xs text-[var(--muted)]">
            {profile?.email}
          </p>
          <form action={signOutAction} className="mt-3">
            <button type="submit" className="text-sm font-semibold underline">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between border-b border-[var(--rule)] bg-white px-4 lg:hidden">
          <Link href={base} className="font-bold">
            Pantry Assistant
          </Link>
          <details className="relative">
            <summary className="list-none border border-[var(--ink)] p-2">
              <Menu size={20} aria-label="Open navigation" />
            </summary>
            <div className="absolute right-0 mt-2 w-72 border border-[var(--ink)] bg-[var(--surface)] p-4">
              <ScopeSwitchers
                organizationId={access.organization.id}
                organizationSlug={access.organization.slug}
                organizations={accessList.map((item) => item.organization)}
                locationId={activeLocationId}
                locations={access.locations}
              />
              <div className="mt-4">{navigation}</div>
            </div>
          </details>
        </header>
        <div className="grid grid-cols-4 border-b border-[var(--rule)] bg-white">
          {[
            {
              label: "User",
              value: profile?.displayName ?? "Signed in",
              icon: UserRound,
            },
            {
              label: "Organization",
              value: access.organization.name,
              icon: ClipboardList,
            },
            {
              label: "Location",
              value:
                access.locations.find(
                  (location) => location.id === activeLocationId,
                )?.name ?? "No active location",
              icon: MapPin,
            },
            {
              label: "Permission scope",
              value:
                access.assignments.map((item) => item.roleName).join(", ") ||
                "No active role",
              icon: ShieldCheck,
            },
          ].map(({ label, value, icon: Icon }, index) => (
            <div
              key={label}
              className="min-w-0 border-r border-[var(--rule)] p-3 last:border-r-0"
            >
              <div className="flex items-center gap-2">
                <span className="tabular text-xs font-semibold text-[var(--signal)]">
                  0{index + 1}
                </span>
                <Icon size={14} aria-hidden />
              </div>
              <p className="mt-1 truncate text-xs text-[var(--muted)]">
                {label}
              </p>
              <p className="truncate text-sm font-semibold">{value}</p>
            </div>
          ))}
        </div>
        <main className="page-enter p-5 sm:p-8 lg:p-12">{children}</main>
      </div>
    </div>
  );
}
