import { getCurrentUser } from "@/lib/auth/access";
import { enqueueAutomationRun, processAutomationRun } from "@/domains/automation/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const operation = String(body.operation ?? "purchase") as "purchase" | "dispose" | "transfer" | "inventory_adjustment";
    const run = await enqueueAutomationRun(user.id, String(body.organizationId ?? ""), String(body.locationId ?? ""), operation);
    const result = body.runNow === true ? await processAutomationRun(String(run.id)) : run;
    return Response.json(result, { status: 202 });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "FORBIDDEN";
    return Response.json({ error: forbidden ? "You do not have permission to run automation." : "The automation request is invalid." }, { status: forbidden ? 403 : 400 });
  }
}
