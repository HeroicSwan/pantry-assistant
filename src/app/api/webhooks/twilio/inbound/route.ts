import { TwilioSmsProvider } from "@/domains/messaging/provider";
import { processInboundWebhook } from "@/domains/messaging/service";

export const runtime = "nodejs";

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function twiml(message: string | null) {
  return new Response(message ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>` : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`, { status: 200, headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const provider = new TwilioSmsProvider();
  if (!(await provider.validateWebhook(request))) return new Response("Invalid webhook signature.", { status: 403 });
  try {
    const event = await provider.parseInboundWebhook(request);
    if (!event.providerMessageId || !event.from || !event.to) return new Response("Malformed inbound event.", { status: 400 });
    const result = await processInboundWebhook(event);
    return twiml(result.response);
  } catch {
    return new Response("Webhook processing failed.", { status: 500 });
  }
}
