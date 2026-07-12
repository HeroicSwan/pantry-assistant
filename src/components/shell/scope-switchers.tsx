"use client";

import { usePathname } from "next/navigation";
import {
  switchLocationAction,
  switchOrganizationAction,
} from "@/domains/admin/actions";

export function ScopeSwitchers({
  organizationId,
  organizationSlug,
  organizations,
  locationId,
  locations,
}: {
  organizationId: string;
  organizationSlug: string;
  organizations: Array<{ id: string; name: string }>;
  locationId: string | null;
  locations: Array<{ id: string; name: string }>;
}) {
  const pathname = usePathname();
  const locationAction = switchLocationAction.bind(null, organizationSlug);
  return (
    <div className="grid gap-3">
      <form
        action={switchOrganizationAction}
        className="grid grid-cols-[1fr_auto] border border-[var(--rule)] bg-white"
      >
        <label className="sr-only" htmlFor="organization-switcher">
          Organization
        </label>
        <select
          id="organization-switcher"
          name="organizationId"
          defaultValue={organizationId}
          className="min-w-0 bg-white px-3 py-2 text-sm font-semibold"
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name}
            </option>
          ))}
        </select>
        <button
          className="border-l border-[var(--rule)] px-3 text-sm font-semibold"
          type="submit"
        >
          Switch
        </button>
      </form>
      <form
        action={locationAction}
        className="grid grid-cols-[1fr_auto] border border-[var(--rule)] bg-white"
      >
        <label className="sr-only" htmlFor="location-switcher">
          Location
        </label>
        <select
          id="location-switcher"
          name="locationId"
          defaultValue={locationId ?? ""}
          className="min-w-0 bg-white px-3 py-2 text-sm"
        >
          {locations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.name}
            </option>
          ))}
        </select>
        <input type="hidden" name="returnTo" value={pathname} />
        <button
          className="border-l border-[var(--rule)] px-3 text-sm font-semibold"
          type="submit"
        >
          Apply
        </button>
      </form>
    </div>
  );
}
