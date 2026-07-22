"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import {
  requireUser,
  verifyOrganizationPermission,
  type PermissionKey,
} from "@/lib/auth/access";
import { DomainError, logServerError, mapProviderError } from "@/lib/errors";
import {
  adjustmentSchema,
  categorySchema,
  itemSchema,
  itemUnitSchema,
  lotSchema,
  parseCheckbox,
  reversalSchema,
  storageLocationSchema,
  unitSchema,
} from "@/domains/inventory/schemas";
import {
  addItemUnit,
  archiveItem,
  createCategory,
  createItem,
  createLot,
  createStorageLocation,
  createUnit,
  recordAdjustment,
  reverseTransaction,
} from "@/domains/inventory/service";
import { importCatalogCsv } from "@/domains/inventory/catalog-import";

function validationFailure(
  requestId: string,
  message = "Review the entered information.",
): ActionResult {
  return { ok: false, code: "VALIDATION_ERROR", message, requestId };
}

function serviceFailure(scope: string, requestId: string, error: unknown) {
  const providerError =
    error instanceof Error
      ? { message: error.message, code: (error as { code?: string }).code }
      : {};
  logServerError(scope, requestId, providerError);
  return mapProviderError(providerError, requestId);
}

async function authorizeOrg(
  organizationId: string,
  permission: PermissionKey,
  requestId: string,
): Promise<ActionResult | null> {
  if (await verifyOrganizationPermission(organizationId, permission))
    return null;
  return {
    ok: false,
    code: "FORBIDDEN",
    message: "You do not have permission to perform this action.",
    requestId,
  };
}

export async function createUnitAction(
  organizationId: string,
  organizationSlug: string,
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  await requireUser();
  const denied = await authorizeOrg(
    organizationId,
    "inventory.manage_catalog",
    requestId,
  );
  if (denied) return denied;
  const parsed = unitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await createUnit(
      await requireUserId(),
      organizationId,
      parsed.data,
      requestId,
    );
  } catch (error) {
    return serviceFailure("inventory.unit_create", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/inventory/catalog`);
  return { ok: true, data: undefined, message: "Unit created.", requestId };
}

export async function createCategoryAction(
  organizationId: string,
  organizationSlug: string,
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  await requireUser();
  const denied = await authorizeOrg(
    organizationId,
    "inventory.manage_catalog",
    requestId,
  );
  if (denied) return denied;
  const parsed = categorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await createCategory(
      await requireUserId(),
      organizationId,
      {
        name: parsed.data.name,
        slug: parsed.data.slug || undefined,
        description: parsed.data.description || undefined,
      },
      requestId,
    );
  } catch (error) {
    return serviceFailure("inventory.category_create", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/inventory/catalog`);
  return { ok: true, data: undefined, message: "Category created.", requestId };
}

export async function createItemAction(
  organizationId: string,
  organizationSlug: string,
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  await requireUser();
  const denied = await authorizeOrg(
    organizationId,
    "inventory.manage_catalog",
    requestId,
  );
  if (denied) return denied;
  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await createItem(
      await requireUserId(),
      organizationId,
      {
        name: parsed.data.name,
        sku: parsed.data.sku || undefined,
        categoryId: parsed.data.categoryId || null,
        baseUnitId: parsed.data.baseUnitId,
        tracksExpiration: parseCheckbox(formData.get("tracksExpiration")),
        notes: parsed.data.notes || undefined,
      },
      requestId,
    );
  } catch (error) {
    return serviceFailure("inventory.item_create", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/inventory/catalog`);
  revalidatePath(`/app/${organizationSlug}/inventory`);
  return { ok: true, data: undefined, message: "Item created.", requestId };
}

export async function importCatalogCsvAction(
  organizationId: string,
  organizationSlug: string,
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  const user = await requireUser();
  const denied = await authorizeOrg(
    organizationId,
    "inventory.manage_catalog",
    requestId,
  );
  if (denied) return denied;
  const file = formData.get("catalogCsv");
  if (!(file instanceof File) || file.size === 0)
    return validationFailure(requestId, "Choose a CSV file to import.");
  if (file.size > 1024 * 1024)
    return validationFailure(requestId, "Use a catalog CSV smaller than 1 MB.");
  try {
    const created = await importCatalogCsv(
      user.id,
      organizationId,
      await file.text(),
      requestId,
    );
    revalidatePath(`/app/${organizationSlug}/inventory/catalog`);
    revalidatePath(`/app/${organizationSlug}/inventory`);
    return {
      ok: true,
      data: undefined,
      message: `Imported ${created.items} item${created.items === 1 ? "" : "s"}; created ${created.categories} categor${created.categories === 1 ? "y" : "ies"} and ${created.units} unit${created.units === 1 ? "" : "s"}.`,
      requestId,
    };
  } catch (error) {
    if (
      error instanceof DomainError &&
      !["FORBIDDEN", "VALIDATION_ERROR"].includes(error.message)
    )
      return validationFailure(requestId, error.message);
    return serviceFailure("inventory.catalog_import", requestId, error);
  }
}

export async function addItemUnitAction(
  organizationId: string,
  organizationSlug: string,
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  await requireUser();
  const denied = await authorizeOrg(
    organizationId,
    "inventory.manage_catalog",
    requestId,
  );
  if (denied) return denied;
  const parsed = itemUnitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await addItemUnit(
      await requireUserId(),
      organizationId,
      parsed.data,
      requestId,
    );
  } catch (error) {
    return serviceFailure("inventory.item_unit_add", requestId, error);
  }
  revalidatePath(
    `/app/${organizationSlug}/inventory/items/${parsed.data.itemId}`,
  );
  return { ok: true, data: undefined, message: "Conversion added.", requestId };
}

export async function archiveItemAction(
  organizationId: string,
  organizationSlug: string,
  itemId: string,
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  await requireUser();
  if (formData.get("confirm") !== "archive")
    return validationFailure(requestId, "Confirm archival before continuing.");
  const denied = await authorizeOrg(
    organizationId,
    "inventory.manage_catalog",
    requestId,
  );
  if (denied) return denied;
  try {
    await archiveItem(await requireUserId(), organizationId, itemId, requestId);
  } catch (error) {
    return serviceFailure("inventory.item_archive", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/inventory/catalog`);
  return { ok: true, data: undefined, message: "Item archived.", requestId };
}

export async function createStorageLocationAction(
  organizationId: string,
  organizationSlug: string,
  pantryLocationId: string,
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  await requireUser();
  const parsed = storageLocationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await createStorageLocation(
      await requireUserId(),
      organizationId,
      pantryLocationId,
      {
        name: parsed.data.name,
        code: parsed.data.code || undefined,
        notes: parsed.data.notes || undefined,
      },
      requestId,
    );
  } catch (error) {
    return serviceFailure("inventory.storage_create", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/inventory/storage`);
  return {
    ok: true,
    data: undefined,
    message: "Storage location created.",
    requestId,
  };
}

export async function createLotAction(
  organizationId: string,
  organizationSlug: string,
  pantryLocationId: string,
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  await requireUser();
  const parsed = lotSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  const wantsOpening =
    Boolean(parsed.data.openingQuantity) && Boolean(parsed.data.openingUnitId);
  try {
    await createLot(
      await requireUserId(),
      organizationId,
      pantryLocationId,
      {
        itemId: parsed.data.itemId,
        storageLocationId: parsed.data.storageLocationId || null,
        lotCode: parsed.data.lotCode || null,
        receivedDate: parsed.data.receivedDate,
        bestByDate: parsed.data.bestByDate || null,
        useByDate: parsed.data.useByDate || null,
        expirationDate: parsed.data.expirationDate || null,
        notes: parsed.data.notes || null,
        opening: wantsOpening
          ? {
              quantity: parsed.data.openingQuantity as string,
              unitId: parsed.data.openingUnitId as string,
            }
          : null,
      },
      requestId,
    );
  } catch (error) {
    return serviceFailure("inventory.lot_create", requestId, error);
  }
  revalidatePath(
    `/app/${organizationSlug}/inventory/items/${parsed.data.itemId}`,
  );
  revalidatePath(`/app/${organizationSlug}/inventory`);
  return { ok: true, data: undefined, message: "Lot created.", requestId };
}

export async function recordAdjustmentAction(
  organizationId: string,
  organizationSlug: string,
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  await requireUser();
  const parsed = adjustmentSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await recordAdjustment(
      await requireUserId(),
      organizationId,
      parsed.data,
      requestId,
    );
  } catch (error) {
    return serviceFailure("inventory.adjustment", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/inventory`);
  revalidatePath(`/app/${organizationSlug}/inventory/activity`);
  return {
    ok: true,
    data: undefined,
    message: "Adjustment posted.",
    requestId,
  };
}

export async function reverseTransactionAction(
  organizationId: string,
  organizationSlug: string,
  _: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const requestId = crypto.randomUUID();
  await requireUser();
  const parsed = reversalSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return validationFailure(requestId);
  try {
    await reverseTransaction(
      await requireUserId(),
      organizationId,
      parsed.data.transactionId,
      parsed.data.reason,
      requestId,
    );
  } catch (error) {
    return serviceFailure("inventory.reverse", requestId, error);
  }
  revalidatePath(`/app/${organizationSlug}/inventory`);
  revalidatePath(`/app/${organizationSlug}/inventory/activity`);
  return {
    ok: true,
    data: undefined,
    message: "Transaction reversed.",
    requestId,
  };
}

async function requireUserId() {
  const user = await requireUser();
  return user.id;
}
