import {
  assessPromptSafety,
  type ReadToolName,
} from "@/domains/assistant/policy";

export type AssistantProviderRequest = {
  prompt: string;
  allowedTools: readonly ReadToolName[];
};

export type AssistantProviderResponse =
  | {
      kind: "tool_call";
      toolName: ReadToolName;
      input: Record<string, unknown>;
    }
  | { kind: "refusal" | "clarification" | "unavailable"; message: string };

export interface AssistantProvider {
  readonly name: string;
  respond(
    request: AssistantProviderRequest,
  ): Promise<AssistantProviderResponse>;
}

export class DisabledAssistantProvider implements AssistantProvider {
  readonly name = "disabled";

  async respond(
    _request: AssistantProviderRequest,
  ): Promise<AssistantProviderResponse> {
    void _request;
    return {
      kind: "unavailable",
      message:
        "The language-model provider is disabled. The approved quick queries remain available.",
    };
  }
}

export class LocalDeterministicAssistantProvider implements AssistantProvider {
  readonly name = "local-deterministic";

  async respond(
    request: AssistantProviderRequest,
  ): Promise<AssistantProviderResponse> {
    const safety = assessPromptSafety(request.prompt);
    if (!safety.safe) return { kind: "refusal", message: safety.message! };

    const normalized = request.prompt.toLowerCase();
    const candidate: ReadToolName | null =
      /forecast|shortage|stockout|run out/.test(normalized)
        ? "get_shortage_forecast"
        : /alert|warning|urgent/.test(normalized)
          ? "get_active_alerts"
          : /inventory|stock|available|on hand/.test(normalized)
            ? "get_inventory_summary"
            : null;

    if (!candidate || !request.allowedTools.includes(candidate)) {
      return {
        kind: "clarification",
        message:
          "Ask about current inventory, shortage forecasts, or active operational alerts for the selected location.",
      };
    }

    if (candidate === "get_shortage_forecast") {
      const requestedHorizon = normalized.match(/\b(\d{1,2})\s*days?\b/);
      const horizonDays = requestedHorizon
        ? Math.min(90, Math.max(1, Number(requestedHorizon[1])))
        : 30;
      return { kind: "tool_call", toolName: candidate, input: { horizonDays } };
    }
    if (candidate === "get_active_alerts")
      return { kind: "tool_call", toolName: candidate, input: { limit: 20 } };
    return { kind: "tool_call", toolName: candidate, input: {} };
  }
}

export function getAssistantProvider(): AssistantProvider {
  return new LocalDeterministicAssistantProvider();
}
