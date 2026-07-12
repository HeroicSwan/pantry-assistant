import { NextResponse } from "next/server";
import { TwilioSmsProvider } from "@/domains/messaging/provider";
import { processStatusWebhook } from "@/domains/messaging/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const provider = new TwilioSmsProvider();
  if (!(await provider.validateWebhook(request))) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 403 });
  try {
    const event = await provider.parseStatusWebhook(request);
    if (!event.providerMessageId || !event.status) return NextResponse.json({ error: "Malformed status event." }, { status: 400 });
    const result = await processStatusWebhook(event);
    return NextResponse.json({ accepted: true, ...result });
  } catch {
    return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 });
  }
}
