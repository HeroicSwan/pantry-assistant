import { z } from "zod";

const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());
const optionalSecret = z.preprocess((value) => value === "" ? undefined : value, z.string().min(32).optional());

const serverEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  TWILIO_WEBHOOK_BASE_URL: optionalUrl,
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5-mini"),
  CRON_SECRET: optionalSecret,
  // Operations assistant model provider. "ollama" runs entirely against a locally hosted Ollama
  // server -- no request ever leaves the machine, unlike OPENAI_API_KEY above, which is used only
  // for document/report generation elsewhere and is never wired into the assistant's tool router.
  ASSISTANT_PROVIDER: z.enum(["disabled", "local-deterministic", "ollama"]).default("local-deterministic"),
  OLLAMA_ASSISTANT_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_ASSISTANT_MODEL: z.string().default("qwen2.5:7b"),
  OLLAMA_ASSISTANT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(30000),
});

const testEnvironmentSchema = z.object({
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  TEST_DATABASE_URL: z.string().url().startsWith("postgresql://"),
});

export function getServerEnvironment() {
  return serverEnvironmentSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    APP_URL: process.env.APP_URL,
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    TWILIO_MESSAGING_SERVICE_SID: process.env.TWILIO_MESSAGING_SERVICE_SID,
    TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
    TWILIO_WEBHOOK_BASE_URL: process.env.TWILIO_WEBHOOK_BASE_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    CRON_SECRET: process.env.CRON_SECRET,
    ASSISTANT_PROVIDER: process.env.ASSISTANT_PROVIDER,
    OLLAMA_ASSISTANT_BASE_URL: process.env.OLLAMA_ASSISTANT_BASE_URL,
    OLLAMA_ASSISTANT_MODEL: process.env.OLLAMA_ASSISTANT_MODEL,
    OLLAMA_ASSISTANT_TIMEOUT_MS: process.env.OLLAMA_ASSISTANT_TIMEOUT_MS,
  });
}

export function getTestEnvironment() {
  return testEnvironmentSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  });
}
