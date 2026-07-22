import { NextResponse } from "next/server";
import { processInboundWebhook } from "@/domains/messaging/service";
import {
  genericWebhookSecretFor,
  GENERIC_WEBHOOK_PROVIDER_IDS,
  providerForMode,
  validateGenericWebhookRequest,
} from "@/domains/messaging/provider";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;
  if (
    !GENERIC_WEBHOOK_PROVIDER_IDS.includes(
      provider as (typeof GENERIC_WEBHOOK_PROVIDER_IDS)[number],
    )
  )
    return NextResponse.json(
      { error: "Invalid webhook authorization." },
      { status: 403 },
    );
  if (
    !validateGenericWebhookRequest(
      request,
      genericWebhookSecretFor(
        provider as (typeof GENERIC_WEBHOOK_PROVIDER_IDS)[number],
      ),
    )
  )
    return NextResponse.json(
      { error: "Invalid webhook authorization." },
      { status: 403 },
    );
  try {
    const event = await providerForMode("live", provider).parseInboundWebhook(
      request,
    );
    if (!event.providerMessageId || !event.from || !event.to)
      return NextResponse.json(
        { error: "Malformed inbound event." },
        { status: 400 },
      );
    const result = await processInboundWebhook(event);
    return NextResponse.json({ ...result, accepted: true });
  } catch {
    return NextResponse.json(
      { error: "Webhook processing failed." },
      { status: 500 },
    );
  }
}
