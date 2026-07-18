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
  VONAGE_API_KEY: z.string().optional(),
  VONAGE_API_SECRET: z.string().optional(),
  PLIVO_AUTH_ID: z.string().optional(),
  PLIVO_AUTH_TOKEN: z.string().optional(),
  TELNYX_API_KEY: z.string().optional(),
  TELNYX_MESSAGING_PROFILE_ID: z.string().optional(),
  SINCH_SERVICE_PLAN_ID: z.string().optional(),
  SINCH_API_TOKEN: z.string().optional(),
  INFOBIP_BASE_URL: optionalUrl,
  INFOBIP_API_KEY: z.string().optional(),
  BANDWIDTH_API_TOKEN: z.string().optional(),
  BANDWIDTH_API_SECRET: z.string().optional(),
  BANDWIDTH_APPLICATION_ID: z.string().optional(),
  BIRD_ACCESS_KEY: z.string().optional(),
  BIRD_WORKSPACE_ID: z.string().optional(),
  BIRD_CHANNEL_ID: z.string().optional(),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_SNS_SENDER_ID: z.string().optional(),
  AZURE_COMMUNICATION_CONNECTION_STRING: z.string().optional(),
  SMS_WEBHOOK_SECRET: optionalSecret,
  SMTP_HOST: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  SMTP_PASSWORD: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  SMTP_FROM: z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional()),
  SMTP_SECURE: z.coerce.boolean().default(false),
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
  AI_CONVERSATION_RETENTION_DAYS: z.coerce.number().int().min(7).max(3650).default(90),
  ASSISTANT_AUTONOMOUS_WRITES_ENABLED: z.coerce.boolean().default(false),
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
    VONAGE_API_KEY: process.env.VONAGE_API_KEY,
    VONAGE_API_SECRET: process.env.VONAGE_API_SECRET,
    PLIVO_AUTH_ID: process.env.PLIVO_AUTH_ID,
    PLIVO_AUTH_TOKEN: process.env.PLIVO_AUTH_TOKEN,
    TELNYX_API_KEY: process.env.TELNYX_API_KEY,
    TELNYX_MESSAGING_PROFILE_ID: process.env.TELNYX_MESSAGING_PROFILE_ID,
    SINCH_SERVICE_PLAN_ID: process.env.SINCH_SERVICE_PLAN_ID,
    SINCH_API_TOKEN: process.env.SINCH_API_TOKEN,
    INFOBIP_BASE_URL: process.env.INFOBIP_BASE_URL,
    INFOBIP_API_KEY: process.env.INFOBIP_API_KEY,
    BANDWIDTH_API_TOKEN: process.env.BANDWIDTH_API_TOKEN,
    BANDWIDTH_API_SECRET: process.env.BANDWIDTH_API_SECRET,
    BANDWIDTH_APPLICATION_ID: process.env.BANDWIDTH_APPLICATION_ID,
    BIRD_ACCESS_KEY: process.env.BIRD_ACCESS_KEY,
    BIRD_WORKSPACE_ID: process.env.BIRD_WORKSPACE_ID,
    BIRD_CHANNEL_ID: process.env.BIRD_CHANNEL_ID,
    AWS_REGION: process.env.AWS_REGION,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    AWS_SNS_SENDER_ID: process.env.AWS_SNS_SENDER_ID,
    AZURE_COMMUNICATION_CONNECTION_STRING: process.env.AZURE_COMMUNICATION_CONNECTION_STRING,
    SMS_WEBHOOK_SECRET: process.env.SMS_WEBHOOK_SECRET,
    SMTP_HOST: process.env.SMTP_HOST,
    SMTP_PORT: process.env.SMTP_PORT,
    SMTP_USER: process.env.SMTP_USER,
    SMTP_PASSWORD: process.env.SMTP_PASSWORD,
    SMTP_FROM: process.env.SMTP_FROM,
    SMTP_SECURE: process.env.SMTP_SECURE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
    CRON_SECRET: process.env.CRON_SECRET,
    ASSISTANT_PROVIDER: process.env.ASSISTANT_PROVIDER,
    OLLAMA_ASSISTANT_BASE_URL: process.env.OLLAMA_ASSISTANT_BASE_URL,
    OLLAMA_ASSISTANT_MODEL: process.env.OLLAMA_ASSISTANT_MODEL,
    OLLAMA_ASSISTANT_TIMEOUT_MS: process.env.OLLAMA_ASSISTANT_TIMEOUT_MS,
    AI_CONVERSATION_RETENTION_DAYS: process.env.AI_CONVERSATION_RETENTION_DAYS,
    ASSISTANT_AUTONOMOUS_WRITES_ENABLED: process.env.ASSISTANT_AUTONOMOUS_WRITES_ENABLED,
  });
}

export function getTestEnvironment() {
  return testEnvironmentSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
  });
}
