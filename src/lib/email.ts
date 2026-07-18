import "server-only";

import nodemailer from "nodemailer";
import { db } from "@/lib/database/client";
import { developmentMessages } from "@/lib/database/schema";
import { getServerEnvironment } from "@/lib/env";

type TransactionalEmail = {
  kind: "password_reset" | "invitation";
  to: string;
  subject: string;
  text: string;
  actionUrl: string;
};

export async function sendTransactionalEmail(input: TransactionalEmail) {
  const environment = getServerEnvironment();
  const recipient = input.to.trim().toLowerCase();

  if (environment.SMTP_HOST && environment.SMTP_FROM) {
    const transporter = nodemailer.createTransport({
      host: environment.SMTP_HOST,
      port: environment.SMTP_PORT,
      secure: environment.SMTP_SECURE,
      ...(environment.SMTP_USER && environment.SMTP_PASSWORD
        ? { auth: { user: environment.SMTP_USER, pass: environment.SMTP_PASSWORD } }
        : {}),
    });

    await transporter.sendMail({
      from: environment.SMTP_FROM,
      to: recipient,
      subject: input.subject,
      text: input.text,
    });
    return { delivered: true, mode: "smtp" as const };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("SMTP delivery is not configured for this production installation.");
  }

  await db.insert(developmentMessages).values({
    kind: input.kind,
    recipient,
    actionUrl: input.actionUrl,
  });
  return { delivered: false, mode: "development-inbox" as const };
}
