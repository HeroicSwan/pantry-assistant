# Authentication, organizations, and permissions

Better Auth provides sign-up, sign-in, sign-out, credential hashing, verification/reset records, and secure sessions in native PostgreSQL. A database trigger creates the matching profile. Password reset links are stored in the server-only development message table until a production email adapter is configured.

Onboarding validates profile, organization, slug, locale/timezone, and initial location data, then runs one transaction: profile update, organization and location creation, active organization/location memberships, administrator assignment, default scope, operation idempotency, and audit events. Duplicate submissions are rejected or return the completed result.

Users may belong to multiple organizations. Organization roles grant only organization-scoped permissions; location roles grant permissions only at an actively assigned location. Effective permissions exclude expired/archived assignments. Active organization and location preferences are stored on the profile but are validated again whenever changed.

Protected pages resolve the session and organization context on the server. Queries accept the acting user and scope. Server Actions validate inputs and perform a preliminary permission check; transactional services repeat it and enforce record ownership before writing. Database constraints provide the final cross-scope boundary.

Administrator, manager, inventory worker, volunteer, and read-only role matrices are seeded. Suspended users may retain an identity session but receive the access-blocked state and cannot perform protected database operations. The final administrator cannot be removed, suspended, archived, or stripped of the last administrator role.

Invitations store only a SHA-256 token hash, expire after seven days, require an email match, and atomically create/reactivate the correct membership, location assignment, role assignment, profile scope, and audit event.

## Diagrams

These diagrams describe the implemented native PostgreSQL and Better Auth foundation. They replace the earlier Supabase `auth.uid()` and Row Level Security design; the equivalent boundary is now the server-only `pantry_app` role plus relational constraints and triggers (see `docs/17-native-windows-postgresql-migration.md`).

### Authentication and protected-route flow

```mermaid
sequenceDiagram
  actor U as User
  participant Pr as Next.js Proxy
  participant Pg as Page / Server Action
  participant BA as Better Auth
  participant DB as PostgreSQL
  U->>BA: sign-up / sign-in (email + password)
  BA->>DB: verify scrypt hash, create session
  BA-->>U: set session cookie
  U->>Pr: request /app/...
  Pr->>Pr: session cookie present?
  Pr-->>U: redirect /sign-in?next=... if absent
  U->>Pg: request with cookie
  Pg->>BA: getSession(headers)
  BA->>DB: load session and user
  Pg->>DB: resolve active membership, scope, effective permissions
  Pg-->>U: authorized view, notFound(), or /access-blocked
```

### Organization onboarding transaction

```mermaid
flowchart TD
  A["Authenticated user submits onboarding"] --> B{"Valid profile, org, slug, location?"}
  B -- no --> E["Validation error, no writes"]
  B -- yes --> T["Single DB transaction (idempotent by operation key)"]
  T --> P["Update user profile"]
  T --> O["Create organization"]
  T --> L["Create initial pantry location"]
  T --> M["Active organization membership"]
  T --> R["Administrator role assignment"]
  T --> S["Set default organization and location scope"]
  T --> AU["Audit events"]
  AU --> D["Redirect to /app/{slug}/dashboard"]
  T -. duplicate submission .-> DR["Return completed result"]
```

### Membership and role relationships

```mermaid
erDiagram
  user ||--|| user_profiles : "1:1 profile"
  user ||--o{ organization_memberships : "member"
  organizations ||--o{ organization_memberships : "has members"
  organizations ||--o{ pantry_locations : "owns"
  organization_memberships ||--o{ location_memberships : "scoped to location"
  pantry_locations ||--o{ location_memberships : "assigns"
  organization_memberships ||--o{ membership_roles : "granted roles"
  roles ||--o{ membership_roles : "assigned as"
  pantry_locations ||--o{ membership_roles : "location-scoped roles"
  roles ||--o{ role_permissions : "grants"
  permissions ||--o{ role_permissions : "granted by"
  organizations ||--o{ organization_invitations : "issues"
  organizations ||--o{ audit_logs : "records"
```

### Permission resolution

```mermaid
flowchart TD
  A["Acting user + active location"] --> B["Load membership role assignments"]
  B --> C{"Membership active and not archived?"}
  C -- no --> Z["Deny by default (empty set)"]
  C -- yes --> D["Keep organization-scoped assignments"]
  C -- yes --> E["Keep location-scoped assignments at the active location"]
  D --> F{"Role archived or assignment expired?"}
  E --> F
  F -- yes --> Z
  F -- no --> G["Union of role_permissions keys"]
  G --> H["Effective permission set"]
```

### Location authorization

```mermaid
flowchart TD
  A["can access location L?"] --> B{"Org membership active and organization active?"}
  B -- no --> D["Deny"]
  B -- yes --> C{"Organization-scoped role grants the permission?"}
  C -- yes --> G["Allow (all-locations access)"]
  C -- no --> E{"Active location_membership for L?"}
  E -- no --> D
  E -- yes --> F{"Location-scoped role grants the permission at L?"}
  F -- yes --> G2["Allow (location-scoped access)"]
  F -- no --> D
```

### Invitation acceptance

```mermaid
sequenceDiagram
  actor U as Invited user
  participant Pg as Accept action
  participant DB as PostgreSQL transaction
  U->>Pg: open /invitations/accept?token=...
  Pg->>Pg: token_hash = sha256(token)
  Pg->>DB: find pending, non-expired invitation by token_hash
  DB-->>Pg: invitation record
  Pg->>Pg: require invitation.email == session email
  Pg->>DB: create or reactivate organization membership
  Pg->>DB: create active location membership (if scoped)
  Pg->>DB: create role assignment (if absent)
  Pg->>DB: mark invitation accepted, set default scope
  Pg->>DB: insert audit event
  Pg-->>U: redirect to organization dashboard
```

### Database authorization enforcement (RLS-equivalent boundary)

```mermaid
flowchart LR
  A["Server service as pantry_app (non-superuser)"] --> B["Permission helper: exists() over memberships/roles/permissions"]
  B -- false --> X["DomainError FORBIDDEN"]
  B -- true --> C["Write inside a transaction"]
  C --> D["Composite scope FKs: (id, organization_id)"]
  C --> E["Triggers: final admin, final location, role scope, audit immutability"]
  D --> F[("Committed state")]
  E --> F
  X --> Y["Mapped safe error; raw SQL never returned to the browser"]
```

### Active organization and location selection

```mermaid
flowchart TD
  A["Request /app/[organizationSlug]"] --> B["Load memberships into access list"]
  B --> C{"Slug in an active-membership access entry?"}
  C -- no --> N["notFound()"]
  C -- yes --> Dn["Active location = preferred default if visible, else first visible"]
  Dn --> Ep["Resolve effective permissions for the active location"]
  Ep --> Fr["Render scoped view"]
  G["Switch organization / location action"] --> H["Re-validate membership and location.view on the server"]
  H -- invalid --> R["Redirect to a safe dashboard"]
  H -- valid --> S["Persist default scope on profile, revalidate paths"]
```
