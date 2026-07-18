import { getCurrentUser } from "@/lib/auth/access";
import { createAutonomousWrite } from "@/domains/assistant/autonomous";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const actionType = String(body.actionType ?? "") as "create_purchase_order" | "dispose_expired_stock";
    if (!["create_purchase_order", "dispose_expired_stock"].includes(actionType)) return Response.json({ error: "Unsupported autonomous action." }, { status: 400 });
    const result = await createAutonomousWrite({ actorId: user.id, organizationId: String(body.organizationId ?? ""), locationId: String(body.locationId ?? ""), actionType, payload: typeof body.payload === "object" && body.payload ? body.payload as Record<string, unknown> : {} });
    return Response.json(result, { status: 202 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "AUTONOMOUS_WRITE_FAILED";
    return Response.json({ error: code === "FORBIDDEN" ? "You do not have permission to use autonomous writes." : code === "AUTONOMOUS_WRITES_DISABLED" ? "Autonomous writes are disabled." : "The autonomous action is invalid." }, { status: code === "FORBIDDEN" ? 403 : 400 });
  }
}
