import { getCurrentUser } from "@/lib/auth/access";
import { storeAttachment } from "@/domains/attachments/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "A file is required." }, { status: 400 });
  try {
    const result = await storeAttachment({ actorId: user.id, organizationId: String(form.get("organizationId") ?? ""), locationId: String(form.get("locationId") ?? ""), entityType: String(form.get("entityType") ?? ""), entityId: String(form.get("entityId") ?? ""), file });
    return Response.json(result, { status: 201 });
  } catch (error) {
    const forbidden = error instanceof Error && error.message === "FORBIDDEN";
    return Response.json({ error: forbidden ? "You do not have permission to upload attachments." : "The attachment could not be stored." }, { status: forbidden ? 403 : 400 });
  }
}
