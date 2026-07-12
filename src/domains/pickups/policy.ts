// Pure, dependency-free household/appointment/reservation policy. Unit tested and mirrored by the
// database triggers in drizzle/0005 as the final boundary.

export type AppointmentStatus =
  | "draft"
  | "scheduled"
  | "confirmed"
  | "arrived"
  | "partially_completed"
  | "completed"
  | "no_show"
  | "cancelled"
  | "rescheduled";

export type ReservationStatus = "active" | "partially_fulfilled" | "fulfilled" | "released" | "expired" | "cancelled";

const APPOINTMENT_TRANSITIONS: Record<AppointmentStatus, readonly AppointmentStatus[]> = {
  draft: ["scheduled", "cancelled"],
  scheduled: ["confirmed", "arrived", "cancelled", "rescheduled", "no_show"],
  confirmed: ["arrived", "cancelled", "rescheduled", "no_show"],
  arrived: ["completed", "partially_completed", "cancelled"],
  partially_completed: ["completed"],
  completed: [],
  no_show: ["scheduled", "arrived"],
  cancelled: [],
  rescheduled: [],
};

export function canTransitionAppointment(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return APPOINTMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

const RESERVATION_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  active: ["partially_fulfilled", "fulfilled", "released", "expired", "cancelled"],
  partially_fulfilled: ["fulfilled", "released", "expired", "cancelled"],
  fulfilled: [],
  released: [],
  expired: [],
  cancelled: [],
};

export function canTransitionReservation(from: ReservationStatus, to: ReservationStatus): boolean {
  return RESERVATION_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Normalize a phone number to E.164-ish storage. Returns null when not plausibly valid. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const digits = input.replace(/[^\d+]/g, "");
  const stripped = digits.startsWith("+") ? digits.slice(1) : digits;
  if (!/^\d{7,15}$/.test(stripped)) return null;
  if (stripped.length === 10) return `+1${stripped}`; // default US formatting for 10-digit input
  if (stripped.length === 11 && stripped.startsWith("1")) return `+${stripped}`;
  return `+${stripped}`;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

export function validateHouseholdCounts(input: {
  householdSize: number;
  adultCount?: number | null;
  childCount?: number | null;
  seniorCount?: number | null;
}): boolean {
  if (!Number.isInteger(input.householdSize) || input.householdSize < 1) return false;
  const parts = [input.adultCount, input.childCount, input.seniorCount];
  let total = 0;
  for (const part of parts) {
    if (part === null || part === undefined) continue;
    if (!Number.isInteger(part) || part < 0) return false;
    total += part;
  }
  return total <= input.householdSize;
}

export type DuplicateSignal = { reason: string; weight: number };

/** Deterministic, explainable duplicate scoring. Score >= 60 is a review candidate. */
export function scoreHouseholdDuplicate(candidate: {
  samePhone: boolean;
  sameEmail: boolean;
  sameExternalReference: boolean;
  similarName: boolean;
}): { score: number; signals: DuplicateSignal[] } {
  const signals: DuplicateSignal[] = [];
  if (candidate.samePhone) signals.push({ reason: "Shared phone number", weight: 50 });
  if (candidate.sameEmail) signals.push({ reason: "Shared email address", weight: 40 });
  if (candidate.sameExternalReference) signals.push({ reason: "Same external reference", weight: 60 });
  if (candidate.similarName) signals.push({ reason: "Similar display name", weight: 30 });
  return { score: signals.reduce((sum, signal) => sum + signal.weight, 0), signals };
}

export function namesSimilar(a: string, b: string): boolean {
  const normalize = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  let shared = 0;
  for (const token of leftTokens) if (rightTokens.has(token) && token.length > 2) shared += 1;
  return shared >= 2 || (shared >= 1 && (leftTokens.size === 1 || rightTokens.size === 1));
}

export type SizeRule = {
  id: string;
  minimumHouseholdSize: number;
  maximumHouseholdSize: number | null;
  quantityMultiplier: string;
};

/** Select the applicable rule: matching range, preferring the highest minimum (most specific). */
export function selectSizeRule(rules: SizeRule[], householdSize: number): SizeRule | null {
  const matching = rules.filter(
    (rule) => householdSize >= rule.minimumHouseholdSize && (rule.maximumHouseholdSize === null || householdSize <= rule.maximumHouseholdSize),
  );
  if (matching.length === 0) return null;
  return matching.sort((a, b) => b.minimumHouseholdSize - a.minimumHouseholdSize)[0];
}

export function rangesOverlap(
  a: { minimumHouseholdSize: number; maximumHouseholdSize: number | null },
  b: { minimumHouseholdSize: number; maximumHouseholdSize: number | null },
): boolean {
  const aMax = a.maximumHouseholdSize ?? Number.POSITIVE_INFINITY;
  const bMax = b.maximumHouseholdSize ?? Number.POSITIVE_INFINITY;
  return a.minimumHouseholdSize <= bMax && b.minimumHouseholdSize <= aMax;
}

/**
 * Multiply a base quantity by a size multiplier with fixed-precision math, rounding UP (ceiling)
 * to whole base units. Allocation quantities are generous rather than fractional: 3 cans x 1.5 -> 5.
 * This documented rounding rule keeps count-based items whole.
 */
export function applySizeMultiplier(baseQuantity: string, multiplier: string): string {
  const parse = (value: string) => {
    if (!/^\d+(\.\d+)?$/.test(value.trim())) throw new Error("INVALID_QUANTITY");
    const [whole, fraction = ""] = value.trim().split(".");
    return { mantissa: BigInt(`${whole}${fraction}` || "0"), scale: fraction.length };
  };
  const quantity = parse(baseQuantity);
  const factor = parse(multiplier);
  if (quantity.mantissa <= BigInt(0) || factor.mantissa <= BigInt(0)) throw new Error("INVALID_QUANTITY");
  const productMantissa = quantity.mantissa * factor.mantissa;
  const scale = quantity.scale + factor.scale;
  const divisor = BigInt(10) ** BigInt(scale);
  const quotient = productMantissa / divisor;
  const remainder = productMantissa % divisor;
  const result = remainder > BigInt(0) ? quotient + BigInt(1) : quotient;
  return result.toString();
}

export type ReservableLot = {
  lotId: string;
  expirationDate: string | null;
  receivedDate: string;
  availableQuantity: number;
};

export type PlannedLotAllocation = { lotId: string; quantity: number };

/**
 * Plan a FEFO allocation across eligible lots. Returns the planned split and any shortage.
 * Deterministic ordering: known expiry ascending, unknown last, received date, lot id.
 */
export function planFefoAllocation(
  lots: ReservableLot[],
  requestedQuantity: number,
): { allocations: PlannedLotAllocation[]; shortage: number } {
  const ordered = lots
    .filter((lot) => lot.availableQuantity > 0)
    .sort((a, b) => {
      if (a.expirationDate !== b.expirationDate) {
        if (a.expirationDate === null) return 1;
        if (b.expirationDate === null) return -1;
        return a.expirationDate < b.expirationDate ? -1 : 1;
      }
      if (a.receivedDate !== b.receivedDate) return a.receivedDate < b.receivedDate ? -1 : 1;
      return a.lotId < b.lotId ? -1 : 1;
    });
  const allocations: PlannedLotAllocation[] = [];
  let remaining = requestedQuantity;
  for (const lot of ordered) {
    if (remaining <= 0) break;
    const take = Math.min(lot.availableQuantity, remaining);
    if (take > 0) {
      allocations.push({ lotId: lot.lotId, quantity: take });
      remaining -= take;
    }
  }
  return { allocations, shortage: Math.max(remaining, 0) };
}

/**
 * A substitute item conflicts when the household has a critical allergen/dietary restriction whose
 * value code appears among the substitute item's category or name tokens. Deterministic keyword rule.
 */
export function substitutionConflicts(
  restrictions: { valueCode: string; severity: string }[],
  substituteText: string,
): { blocked: boolean; conflictCode?: string } {
  const haystack = substituteText.toLowerCase();
  for (const restriction of restrictions) {
    if (restriction.severity !== "critical") continue;
    // "nut_free" -> "nut", "no_pork" -> "pork", "dairy_free" -> "dairy"
    const needle = restriction.valueCode.replace(/^no_/, "").replace(/_free$/, "").replaceAll("_", " ");
    if (needle && haystack.includes(needle)) return { blocked: true, conflictCode: restriction.valueCode };
  }
  return { blocked: false };
}

export function checkInEligible(status: AppointmentStatus): boolean {
  return status === "scheduled" || status === "confirmed";
}

export function noShowEligible(status: AppointmentStatus, scheduledEndAt: Date, now = new Date()): boolean {
  return (status === "scheduled" || status === "confirmed") && now >= scheduledEndAt;
}

export function cancellationEligible(status: AppointmentStatus): boolean {
  return ["draft", "scheduled", "confirmed", "arrived"].includes(status);
}

export function rescheduleEligible(status: AppointmentStatus): boolean {
  return status === "scheduled" || status === "confirmed";
}

/** Remaining active reserved quantity on a reservation line or lot allocation. */
export function remainingReserved(input: { reserved: number; fulfilled: number; released: number }): number {
  return Math.max(input.reserved - input.fulfilled - input.released, 0);
}
