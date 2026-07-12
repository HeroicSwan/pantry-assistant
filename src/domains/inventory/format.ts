// Trim trailing zeros from a fixed-scale numeric string for display (e.g. "12.500000" -> "12.5").
export function formatQuantity(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "0";
  const text = typeof value === "number" ? String(value) : value.trim();
  if (!text.includes(".")) return text;
  return text.replace(/\.?0+$/, "");
}

const TRANSACTION_LABELS: Record<string, string> = {
  opening_balance: "Opening balance",
  donation_received: "Donation received",
  purchase_received: "Purchase received",
  transfer_in: "Transfer in",
  manual_positive_adjustment: "Positive adjustment",
  distribution: "Distribution",
  spoilage: "Spoilage",
  damage: "Damage",
  expiration: "Expiration removal",
  recall_disposal: "Recall disposal",
  transfer_out: "Transfer out",
  manual_negative_adjustment: "Negative adjustment",
  pickup_fulfillment: "Pickup fulfillment",
  reversal: "Reversal",
};

export function transactionLabel(type: string): string {
  return TRANSACTION_LABELS[type] ?? type;
}
