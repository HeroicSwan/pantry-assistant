import { describe, expect, it } from "vitest";
import { onboardingSchema } from "@/domains/onboarding/schemas";

const validInput = {
  idempotencyKey: "10000000-0000-4000-8000-000000000001",
  profile: {
    displayName: "Avery Morgan",
    firstName: "Avery",
    lastName: "Morgan",
    preferredLocale: "en-US",
  },
  organization: {
    name: "Harbor Community Food Pantry",
    slug: "harbor-community-food-pantry",
    timezone: "America/New_York",
    defaultLocale: "en-US",
    email: "administrator@harbor-pantry.test",
    phoneNumber: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateRegion: "",
    postalCode: "",
    countryCode: "US",
  },
  location: {
    name: "Downtown Pantry",
    slug: "downtown-pantry",
    timezone: "America/New_York",
    email: "",
    phoneNumber: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateRegion: "",
    postalCode: "",
    countryCode: "US",
    operatingNotes: "",
  },
};

describe("onboarding schema", () => {
  it("accepts the minimum transactional onboarding input", () => {
    expect(onboardingSchema.safeParse(validInput).success).toBe(true);
  });

  it("rejects unsupported timezones and unsafe slugs", () => {
    const result = onboardingSchema.safeParse({
      ...validInput,
      organization: {
        ...validInput.organization,
        slug: "Harbor Pantry",
        timezone: "Local",
      },
    });
    expect(result.success).toBe(false);
  });
});
