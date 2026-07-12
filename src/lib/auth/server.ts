import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/database/client";
import * as schema from "@/lib/database/schema";
import { developmentMessages } from "@/lib/database/schema";
import { getServerEnvironment } from "@/lib/env";

const environment = getServerEnvironment();

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg", schema }),
  secret: environment.BETTER_AUTH_SECRET,
  baseURL: environment.BETTER_AUTH_URL,
  trustedOrigins: [environment.APP_URL, environment.BETTER_AUTH_URL],
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      await db.insert(developmentMessages).values({
        kind: "password_reset",
        recipient: user.email.toLowerCase(),
        actionUrl: url,
      });
    },
  },
  advanced: { database: { generateId: "uuid" } },
  plugins: [nextCookies()],
});
