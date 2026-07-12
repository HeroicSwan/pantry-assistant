import { describe, expect, it } from "vitest";
import { isValidTimeZone, normalizeSlug, slugSchema } from "@/lib/validation";

describe("foundation validation", () => {
  it("normalizes organization and location slugs", () => {
    expect(normalizeSlug(" Harbor Community Food Pantry ")).toBe(
      "harbor-community-food-pantry",
    );
    expect(slugSchema.safeParse("harbor--pantry").success).toBe(false);
  });

  it("validates IANA timezones", () => {
    expect(isValidTimeZone("America/New_York")).toBe(true);
    expect(isValidTimeZone("Eastern Pantry Time")).toBe(false);
  });
});
