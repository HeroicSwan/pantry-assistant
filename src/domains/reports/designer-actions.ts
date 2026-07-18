"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { saveReportDefinition } from "@/domains/reports/designer";
import { requireUser } from "@/lib/auth/access";

export async function saveReportDefinitionAction(organizationId: string, organizationSlug: string, _state: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  await saveReportDefinition(user.id, organizationId, {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    definition: { source: String(formData.get("source") ?? "inventory-on-hand"), columns: String(formData.get("columns") ?? "").split(",").map((value) => value.trim()).filter(Boolean) },
    shared: formData.get("shared") === "on",
  });
  revalidatePath(`/app/${organizationSlug}/reports/designer`);
  return { ok: true, data: undefined, message: "Report layout saved.", requestId: crypto.randomUUID() };
}
