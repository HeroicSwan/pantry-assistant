import { getCurrentUser } from "@/lib/auth/access";
import { recordEligibilityVerification } from "@/domains/compliance/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const result = await recordEligibilityVerification({ actorId: user.id, organizationId: String(body.organizationId ?? ""), locationId: String(body.locationId ?? ""), householdId: String(body.householdId ?? ""), programCode: String(body.programCode ?? ""), status: String(body.status ?? "manual_review") as "pending" | "verified" | "expired" | "denied" | "manual_review", expiresAt: body.expiresAt ? new Date(String(body.expiresAt)) : null, evidenceReference: body.evidenceReference ? String(body.evidenceReference) : null, notes: body.notes ? String(body.notes) : null });
    return Response.json(result, { status: 201 });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "FORBIDDEN";
    return Response.json({ error: forbidden ? "You do not have permission to manage eligibility." : "The eligibility record is invalid." }, { status: forbidden ? 403 : 400 });
  }
}
