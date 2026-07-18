import { NextResponse } from "next/server";
import { processStatusWebhook } from "@/domains/messaging/service";
import { providerForMode, SMS_PROVIDER_IDS, validateGenericWebhookRequest } from "@/domains/messaging/provider";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!SMS_PROVIDER_IDS.includes(provider as (typeof SMS_PROVIDER_IDS)[number]) || !validateGenericWebhookRequest(request)) return NextResponse.json({ error: "Invalid webhook authorization." }, { status: 403 });
  try {
    const event = await providerForMode("live", provider).parseStatusWebhook(request);
    if (!event.providerMessageId || !event.status) return NextResponse.json({ error: "Malformed status event." }, { status: 400 });
    const result = await processStatusWebhook(event);
    return NextResponse.json({ accepted: true, ...result });
  } catch { return NextResponse.json({ error: "Webhook processing failed." }, { status: 500 }); }
}
