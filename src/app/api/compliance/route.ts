import { getCurrentUser } from "@/lib/auth/access";
import { saveComplianceProfile } from "@/domains/compliance/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const result = await saveComplianceProfile({ actorId: user.id, organizationId: String(body.organizationId ?? ""), countryCode: String(body.countryCode ?? "US").toUpperCase(), enabled: body.enabled !== false, rules: typeof body.rules === "object" && body.rules ? body.rules as Record<string, unknown> : {} });
    return Response.json(result, { status: 201 });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "FORBIDDEN";
    return Response.json({ error: forbidden ? "You do not have permission to manage compliance." : "The compliance profile is invalid." }, { status: forbidden ? 403 : 400 });
  }
}
