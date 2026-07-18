import { afterEach, describe, expect, it, vi } from "vitest";
import { getServerEnvironment } from "@/lib/env";

const REQUIRED = {
  DATABASE_URL: "postgresql://user:pass@localhost:5432/pantry",
  BETTER_AUTH_SECRET: "a".repeat(32),
};

function stubEnv(overrides: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries({ ...REQUIRED, ...overrides })) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
}

describe("assistant provider environment schema", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the local deterministic provider with no Ollama configuration required", () => {
    stubEnv({});
    const environment = getServerEnvironment();
    expect(environment.ASSISTANT_PROVIDER).toBe("ollama");
    expect(environment.OLLAMA_ASSISTANT_BASE_URL).toBe("http://127.0.0.1:11434");
    expect(environment.OLLAMA_ASSISTANT_MODEL).toBe("qwen2.5:7b");
    expect(environment.OLLAMA_ASSISTANT_TIMEOUT_MS).toBe(30_000);
  });

  it("accepts an explicit local Ollama configuration", () => {
    stubEnv({
      ASSISTANT_PROVIDER: "ollama",
      OLLAMA_ASSISTANT_BASE_URL: "http://127.0.0.1:11434",
      OLLAMA_ASSISTANT_MODEL: "qwen2.5:14b",
      OLLAMA_ASSISTANT_TIMEOUT_MS: "15000",
    });
    const environment = getServerEnvironment();
    expect(environment.ASSISTANT_PROVIDER).toBe("ollama");
    expect(environment.OLLAMA_ASSISTANT_MODEL).toBe("qwen2.5:14b");
    expect(environment.OLLAMA_ASSISTANT_TIMEOUT_MS).toBe(15_000);
  });

  it("rejects an unrecognized provider value", () => {
    stubEnv({ ASSISTANT_PROVIDER: "remote-provider" });
    expect(() => getServerEnvironment()).toThrow();
  });

  it("rejects a non-URL Ollama base URL", () => {
    stubEnv({ OLLAMA_ASSISTANT_BASE_URL: "not-a-url" });
    expect(() => getServerEnvironment()).toThrow();
  });

  it("rejects a timeout outside the bounded 1s-120s range", () => {
    stubEnv({ OLLAMA_ASSISTANT_TIMEOUT_MS: "500" });
    expect(() => getServerEnvironment()).toThrow();
    vi.unstubAllEnvs();
    stubEnv({ OLLAMA_ASSISTANT_TIMEOUT_MS: "500000" });
    expect(() => getServerEnvironment()).toThrow();
  });

  it("allows disabling the assistant entirely", () => {
    stubEnv({ ASSISTANT_PROVIDER: "disabled" });
    expect(getServerEnvironment().ASSISTANT_PROVIDER).toBe("disabled");
  });
});
