import "server-only";

import { parse } from "csv-parse/sync";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/database/client";
import { hasOrganizationPermission } from "@/lib/database/authorization";
import {
  auditLogs,
  inventoryCategories,
  inventoryItemUnits,
  inventoryItems,
  organizationMemberships,
  unitsOfMeasure,
} from "@/lib/database/schema";
import { DomainError } from "@/lib/errors";
import { normalizeSlug } from "@/lib/validation";

type UnitDimension = "count" | "mass" | "volume";

export type CatalogImportRow = {
  name: string;
  sku: string | null;
  category: string | null;
  baseUnit: string;
  unitDimension: UnitDimension;
  tracksExpiration: boolean;
};

const expectedColumns = new Set([
  "name",
  "sku",
  "category",
  "base_unit",
  "unit_dimension",
  "tracks_expiration",
]);

function value(raw: Record<string, string>, key: string) {
  return (raw[key] ?? "").trim();
}

function invalid(message: string): never {
  throw new DomainError(message);
}

export function parseCatalogImport(csv: string): CatalogImportRow[] {
  let rawRows: Record<string, string>[];
  try {
    rawRows = parse(csv, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 4096,
    });
  } catch {
    return invalid(
      "The CSV file could not be read. Use a comma-separated file with the required heading row.",
    );
  }

  if (!rawRows.length) invalid("The CSV file has no catalog rows.");
  if (rawRows.length > 1000)
    invalid("Import up to 1,000 catalog rows at a time.");
  const columns = Object.keys(rawRows[0] ?? {});
  if (
    columns.some((column) => !expectedColumns.has(column)) ||
    !["name", "base_unit", "unit_dimension"].every((column) =>
      columns.includes(column),
    )
  ) {
    invalid(
      "Use exactly these CSV columns: name, sku, category, base_unit, unit_dimension, tracks_expiration.",
    );
  }

  const names = new Set<string>();
  const skus = new Set<string>();
  const units = new Map<string, UnitDimension>();
  return rawRows.map((raw, index) => {
    const line = index + 2;
    const name = value(raw, "name");
    const sku = value(raw, "sku") || null;
    const category = value(raw, "category") || null;
    const baseUnit = value(raw, "base_unit");
    const dimension = value(raw, "unit_dimension").toLowerCase();
    const expiration = value(raw, "tracks_expiration").toLowerCase();

    if (!name || name.length > 120)
      invalid(
        `Row ${line}: name is required and must be 120 characters or fewer.`,
      );
    if (sku && sku.length > 60)
      invalid(`Row ${line}: SKU / PLU must be 60 characters or fewer.`);
    if (category && category.length > 80)
      invalid(`Row ${line}: category must be 80 characters or fewer.`);
    if (!baseUnit || baseUnit.length > 60)
      invalid(
        `Row ${line}: base_unit is required and must be 60 characters or fewer.`,
      );
    if (dimension !== "count" && dimension !== "mass" && dimension !== "volume")
      invalid(`Row ${line}: unit_dimension must be count, mass, or volume.`);
    if (
      expiration &&
      !["true", "false", "yes", "no", "1", "0"].includes(expiration)
    )
      invalid(`Row ${line}: tracks_expiration must be true or false.`);

    const nameKey = name.toLocaleLowerCase();
    const skuKey = sku?.toLocaleLowerCase();
    const unitKey = baseUnit.toLocaleLowerCase();
    if (names.has(nameKey))
      invalid(`Row ${line}: duplicate item name in this file.`);
    if (skuKey && skus.has(skuKey))
      invalid(`Row ${line}: duplicate SKU / PLU in this file.`);
    if (units.has(unitKey) && units.get(unitKey) !== dimension)
      invalid(
        `Row ${line}: base unit '${baseUnit}' has conflicting dimensions.`,
      );
    names.add(nameKey);
    if (skuKey) skus.add(skuKey);
    units.set(unitKey, dimension as UnitDimension);

    return {
      name,
      sku,
      category,
      baseUnit,
      unitDimension: dimension as UnitDimension,
      tracksExpiration: ["true", "yes", "1"].includes(expiration),
    };
  });
}

export async function importCatalogCsv(
  actorId: string,
  organizationId: string,
  csv: string,
  requestId: string,
) {
  const rows = parseCatalogImport(csv);
  return db.transaction(async (tx) => {
    if (
      !(await hasOrganizationPermission(
        tx,
        actorId,
        organizationId,
        "inventory.manage_catalog",
      ))
    )
      throw new DomainError("FORBIDDEN");
    const [membership] = await tx
      .select({ id: organizationMemberships.id })
      .from(organizationMemberships)
      .where(
        and(
          eq(organizationMemberships.userId, actorId),
          eq(organizationMemberships.organizationId, organizationId),
          eq(organizationMemberships.status, "active"),
        ),
      )
      .limit(1);
    if (!membership) throw new DomainError("FORBIDDEN");

    const [existingUnits, existingCategories, existingItems] =
      await Promise.all([
        tx
          .select({
            id: unitsOfMeasure.id,
            name: unitsOfMeasure.name,
            abbreviation: unitsOfMeasure.abbreviation,
            dimension: unitsOfMeasure.dimension,
          })
          .from(unitsOfMeasure)
          .where(eq(unitsOfMeasure.organizationId, organizationId)),
        tx
          .select({
            id: inventoryCategories.id,
            slug: inventoryCategories.slug,
          })
          .from(inventoryCategories)
          .where(eq(inventoryCategories.organizationId, organizationId)),
        tx
          .select({ name: inventoryItems.name, sku: inventoryItems.sku })
          .from(inventoryItems)
          .where(eq(inventoryItems.organizationId, organizationId)),
      ]);

    const units = new Map(
      existingUnits.flatMap((unit) => [
        [unit.name.toLocaleLowerCase(), unit],
        [unit.abbreviation.toLocaleLowerCase(), unit],
      ]),
    );
    const categories = new Map(
      existingCategories.map((category) => [category.slug, category]),
    );
    const itemNames = new Set(
      existingItems.map((item) => item.name.toLocaleLowerCase()),
    );
    const itemSkus = new Set(
      existingItems.flatMap((item) =>
        item.sku ? [item.sku.toLocaleLowerCase()] : [],
      ),
    );
    const created = { items: 0, categories: 0, units: 0 };

    for (const row of rows) {
      const itemName = row.name.toLocaleLowerCase();
      const itemSku = row.sku?.toLocaleLowerCase();
      if (itemNames.has(itemName))
        invalid(
          `An item named '${row.name}' already exists. Imports never overwrite catalog items.`,
        );
      if (itemSku && itemSkus.has(itemSku))
        invalid(
          `An item with SKU / PLU '${row.sku}' already exists. Imports never overwrite catalog items.`,
        );

      const unitKey = row.baseUnit.toLocaleLowerCase();
      let unit = units.get(unitKey);
      if (unit && unit.dimension !== row.unitDimension)
        invalid(
          `The existing unit '${row.baseUnit}' has a different dimension.`,
        );
      if (!unit) {
        const [inserted] = await tx
          .insert(unitsOfMeasure)
          .values({
            organizationId,
            name: row.baseUnit,
            abbreviation: row.baseUnit,
            dimension: row.unitDimension,
            createdBy: actorId,
          })
          .returning();
        unit = inserted;
        units.set(unitKey, unit);
        created.units += 1;
      }

      let categoryId: string | null = null;
      if (row.category) {
        const slug = normalizeSlug(row.category);
        if (!slug)
          invalid(
            `Category '${row.category}' cannot be converted to a valid slug.`,
          );
        let category = categories.get(slug);
        if (!category) {
          const [inserted] = await tx
            .insert(inventoryCategories)
            .values({
              organizationId,
              name: row.category,
              slug,
              createdBy: actorId,
            })
            .returning();
          category = inserted;
          categories.set(slug, category);
          created.categories += 1;
        }
        categoryId = category.id;
      }

      const [item] = await tx
        .insert(inventoryItems)
        .values({
          organizationId,
          categoryId,
          name: row.name,
          sku: row.sku,
          baseUnitId: unit.id,
          tracksExpiration: row.tracksExpiration,
          createdBy: actorId,
        })
        .returning();
      await tx
        .insert(inventoryItemUnits)
        .values({
          organizationId,
          inventoryItemId: item.id,
          unitId: unit.id,
          factor: "1",
          roundingPolicy: "reject",
          isBaseUnit: true,
          isActive: true,
          createdBy: actorId,
        });
      itemNames.add(itemName);
      if (itemSku) itemSkus.add(itemSku);
      created.items += 1;
    }

    await tx.insert(auditLogs).values({
      organizationId,
      actorUserId: actorId,
      actorMembershipId: membership.id,
      action: "inventory.catalog_imported",
      entityType: "inventory_catalog",
      entityId: organizationId,
      requestId,
      newValues: { rows: rows.length, ...created },
    });
    return created;
  });
}
