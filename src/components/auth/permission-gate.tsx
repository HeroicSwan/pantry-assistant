import type { PermissionKey } from "@/lib/auth/access";

export function PermissionGate({
  permissions,
  permission,
  children,
  fallback = null,
}: {
  permissions: ReadonlySet<PermissionKey>;
  permission: PermissionKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  return permissions.has(permission) ? children : fallback;
}
