import "server-only";

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/lib/database/client";
import * as schema from "@/lib/database/schema";
import { getServerEnvironment } from "@/lib/env";
import { sendTransactionalEmail } from "@/lib/email";

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
      await sendTransactionalEmail({
        kind: "password_reset",
        to: user.email,
        subject: "Reset your Pantry Assistant password",
        text: `Use this link to reset your Pantry Assistant password:\n\n${url}`,
        actionUrl: url,
      });
    },
  },
  advanced: { database: { generateId: "uuid" } },
  plugins: [nextCookies()],
});
