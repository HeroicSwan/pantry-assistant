import { describe, expect, it } from "vitest";
import { mapProviderError } from "@/lib/errors";

describe("security-safe error mapping", () => {
  it("maps known database safety errors", () => {
    expect(
      mapProviderError({ message: "FINAL_ADMINISTRATOR" }, "request-1"),
    ).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("does not expose unknown provider messages", () => {
    const result = mapProviderError(
      { message: "password=secret database detail" },
      "request-2",
    );
    expect(result).toMatchObject({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "The operation could not be completed.",
    });
  });
});
