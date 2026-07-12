// Pure, dependency-free inventory ledger policy. These functions are unit tested and are the
// single source of truth for conversion, FEFO ordering, availability, and transaction-sign rules.
// The database triggers in drizzle/0003 enforce the same rules as the final boundary.

export type TransactionType =
  | "opening_balance"
  | "donation_received"
  | "purchase_received"
  | "transfer_in"
  | "manual_positive_adjustment"
  | "distribution"
  | "spoilage"
  | "damage"
  | "expiration"
  | "recall_disposal"
  | "transfer_out"
  | "manual_negative_adjustment"
  | "pickup_fulfillment"
  | "reversal";

export type RoundingPolicy = "reject" | "floor" | "ceiling" | "half_up";

export const POSITIVE_TRANSACTION_TYPES: ReadonlySet<TransactionType> = new Set([
  "opening_balance",
  "donation_received",
  "purchase_received",
  "transfer_in",
  "manual_positive_adjustment",
]);

export const NEGATIVE_TRANSACTION_TYPES: ReadonlySet<TransactionType> = new Set([
  "distribution",
  "spoilage",
  "damage",
  "expiration",
  "recall_disposal",
  "transfer_out",
  "manual_negative_adjustment",
  "pickup_fulfillment",
]);

export function transactionSign(type: TransactionType): "positive" | "negative" | "reversal" {
  if (type === "reversal") return "reversal";
  return POSITIVE_TRANSACTION_TYPES.has(type) ? "positive" : "negative";
}

export function isSignValid(type: TransactionType, delta: number): boolean {
  if (delta === 0) return false;
  const sign = transactionSign(type);
  if (sign === "positive") return delta > 0;
  if (sign === "negative") return delta < 0;
  return true; // reversal sign depends on the original; validated against the target elsewhere
}

const BASE_SCALE = 6;
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const TEN = BigInt(10);

function pow10(exponent: number): bigint {
  return TEN ** BigInt(exponent);
}

function parseDecimal(value: string): { mantissa: bigint; scale: number } {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) throw new Error("INVALID_QUANTITY");
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  const mantissa = BigInt(digits === "" ? "0" : digits);
  return { mantissa: negative ? -mantissa : mantissa, scale: fraction.length };
}

function formatScaled(mantissa: bigint, scale: number): string {
  const negative = mantissa < ZERO;
  let digits = (negative ? -mantissa : mantissa).toString();
  if (scale === 0) return `${negative ? "-" : ""}${digits}`;
  digits = digits.padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = digits.slice(digits.length - scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Resolve a caller-entered quantity in some unit into the item's base unit using a server-supplied
 * conversion factor. Never trusts a client base quantity. Rounds to 6 base decimals under the
 * declared policy; "reject" refuses any quantity that is not exactly representable.
 */
export function resolveBaseQuantity(
  inputQuantity: string,
  factor: string,
  policy: RoundingPolicy,
): { base: string; roundingDelta: string } {
  const input = parseDecimal(inputQuantity);
  const conversion = parseDecimal(factor);
  if (input.mantissa <= ZERO) throw new Error("INVALID_QUANTITY");
  if (conversion.mantissa <= ZERO) throw new Error("MISSING_UNIT_CONVERSION");

  const productMantissa = input.mantissa * conversion.mantissa;
  const productScale = input.scale + conversion.scale;

  if (productScale <= BASE_SCALE) {
    const scaledUp = productMantissa * pow10(BASE_SCALE - productScale);
    return { base: formatScaled(scaledUp, BASE_SCALE), roundingDelta: "0" };
  }

  const drop = productScale - BASE_SCALE;
  const divisor = pow10(drop);
  const quotient = productMantissa / divisor;
  const remainder = productMantissa % divisor;

  let baseMantissa = quotient;
  if (remainder !== ZERO) {
    if (policy === "reject") throw new Error("ROUNDING_REQUIRED");
    if (policy === "ceiling") baseMantissa = quotient + ONE;
    else if (policy === "half_up" && remainder * TWO >= divisor) baseMantissa = quotient + ONE;
    // floor keeps the quotient
  }

  // roundingDelta = chosen base value - exact product, expressed at the product scale.
  const deltaMantissa = baseMantissa * divisor - productMantissa;
  return {
    base: formatScaled(baseMantissa, BASE_SCALE),
    roundingDelta: formatScaled(deltaMantissa, productScale),
  };
}

export type FefoLot = {
  expirationDate: string | null;
  receivedDate: string;
  lotId: string;
};

/** First-Expired-First-Out ordering: known expiry ascending, unknown expiry last, then received date, then id. */
export function compareFefo(a: FefoLot, b: FefoLot): number {
  if (a.expirationDate !== b.expirationDate) {
    if (a.expirationDate === null) return 1;
    if (b.expirationDate === null) return -1;
    return a.expirationDate < b.expirationDate ? -1 : 1;
  }
  if (a.receivedDate !== b.receivedDate) return a.receivedDate < b.receivedDate ? -1 : 1;
  return a.lotId < b.lotId ? -1 : a.lotId > b.lotId ? 1 : 0;
}

export function isExpiredOn(expirationDate: string | null, localDate: string): boolean {
  return expirationDate !== null && expirationDate < localDate;
}

export type LotBalanceInput = {
  physicalOnHand: number;
  isExpired: boolean;
  lotStatus: "active" | "depleted" | "archived";
};

/** Mirrors the inventory_lot_balances view. available == valid_on_hand for Prompt 3. */
export function lotAvailability(input: LotBalanceInput) {
  const expiredQuantity = input.isExpired ? input.physicalOnHand : 0;
  const usable = input.lotStatus === "active" && !input.isExpired ? input.physicalOnHand : 0;
  return { physicalOnHand: input.physicalOnHand, expiredQuantity, validOnHand: usable, available: usable };
}

export function canReverse(input: { isReversal: boolean; alreadyReversed: boolean }): {
  ok: boolean;
  reason?: string;
} {
  if (input.isReversal) return { ok: false, reason: "CANNOT_REVERSE_REVERSAL" };
  if (input.alreadyReversed) return { ok: false, reason: "ALREADY_REVERSED" };
  return { ok: true };
}
