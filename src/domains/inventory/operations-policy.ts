export type AdjustmentRisk = "normal" | "high";

const HIGH_ADJUSTMENT_ABSOLUTE = 25;
const HIGH_ADJUSTMENT_PERCENT = 0.2;

export function classifyAdjustmentRisk(baseQuantity: number, physicalOnHand: number): AdjustmentRisk {
  if (!Number.isFinite(baseQuantity) || baseQuantity <= 0) throw new Error("INVALID_QUANTITY");
  if (baseQuantity >= HIGH_ADJUSTMENT_ABSOLUTE) return "high";
  if (physicalOnHand > 0 && baseQuantity / physicalOnHand >= HIGH_ADJUSTMENT_PERCENT) return "high";
  return "normal";
}

export function adjustmentMayPost(input: {
  risk: AdjustmentRisk;
  requesterId: string;
  approverId?: string | null;
  hasStandardPermission: boolean;
  hasLargePermission: boolean;
}) {
  if (!input.hasStandardPermission) return false;
  if (input.risk === "normal") return true;
  return Boolean(input.hasLargePermission && input.approverId && input.approverId !== input.requesterId);
}

export function transferStateAllows(
  current: string,
  action: "request" | "approve" | "dispatch" | "receive" | "cancel" | "resolve",
) {
  const allowed: Record<typeof action, string[]> = {
    request: ["draft"],
    approve: ["requested"],
    dispatch: ["approved"],
    receive: ["dispatched", "partially_received"],
    cancel: ["draft", "requested", "approved"],
    resolve: ["partially_received", "received"],
  };
  return allowed[action].includes(current);
}

export function countStateAllows(
  current: string,
  action: "enter" | "submit" | "approve" | "reconcile" | "cancel",
) {
  const allowed: Record<typeof action, string[]> = {
    enter: ["draft", "counting"],
    submit: ["counting"],
    approve: ["submitted"],
    reconcile: ["approved"],
    cancel: ["draft", "counting", "submitted"],
  };
  return allowed[action].includes(current);
}

export function decimalDifference(minuend: string, subtrahend: string) {
  return (Number(minuend) - Number(subtrahend)).toFixed(6);
}

export function transferCompletionStatus(dispatched: number, received: number) {
  if (received <= 0) return "dispatched" as const;
  if (received < dispatched) return "partially_received" as const;
  return "received" as const;
}
