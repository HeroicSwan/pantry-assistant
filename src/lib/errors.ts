import type { ActionErrorCode, ActionResult } from "@/lib/action-result";

type ProviderError = { code?: string; message?: string; status?: number };

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

const safeMessages: Record<string, { code: ActionErrorCode; message: string }> =
  {
    UNAUTHENTICATED: {
      code: "UNAUTHENTICATED",
      message: "Please sign in and try again.",
    },
    FORBIDDEN: {
      code: "FORBIDDEN",
      message: "You do not have permission to perform this action.",
    },
    NOT_FOUND: {
      code: "NOT_FOUND",
      message: "The requested record was not found or is unavailable.",
    },
    FINAL_ADMINISTRATOR: {
      code: "CONFLICT",
      message:
        "The organization must retain at least one active administrator.",
    },
    FINAL_ACTIVE_LOCATION: {
      code: "CONFLICT",
      message: "Create another active location before archiving this one.",
    },
    IDEMPOTENCY_CONFLICT: {
      code: "CONFLICT",
      message:
        "This submission key was already used for different information.",
    },
    DUPLICATE_ROLE_ASSIGNMENT: {
      code: "CONFLICT",
      message: "That role is already assigned in this scope.",
    },
    INVALID_OR_EXPIRED_INVITATION: {
      code: "NOT_FOUND",
      message: "This invitation is invalid or has expired.",
    },
    MEMBERSHIP_BLOCKED: {
      code: "FORBIDDEN",
      message: "This membership cannot be activated by invitation.",
    },
    VALIDATION_ERROR: {
      code: "VALIDATION_ERROR",
      message: "Review the entered information and try again.",
    },
    INSUFFICIENT_STOCK: {
      code: "CONFLICT",
      message: "That quantity would drive the lot below zero on hand.",
    },
    LEDGER_IMMUTABLE: {
      code: "CONFLICT",
      message: "Posted inventory transactions cannot be edited or deleted.",
    },
    LOT_ARCHIVED: {
      code: "CONFLICT",
      message: "This lot is archived and cannot receive new transactions.",
    },
    ITEM_ARCHIVED: {
      code: "CONFLICT",
      message: "This item is archived. Restore it before adding inventory.",
    },
    TRANSACTION_SIGN_INVALID: {
      code: "VALIDATION_ERROR",
      message: "The quantity direction does not match the transaction type.",
    },
    UNIT_DIMENSION_MISMATCH: {
      code: "VALIDATION_ERROR",
      message: "The unit must match the item's base unit dimension.",
    },
    MISSING_UNIT_CONVERSION: {
      code: "VALIDATION_ERROR",
      message: "No active conversion exists for that unit on this item.",
    },
    ROUNDING_REQUIRED: {
      code: "VALIDATION_ERROR",
      message: "That quantity cannot be represented exactly in the base unit.",
    },
    INVALID_QUANTITY: {
      code: "VALIDATION_ERROR",
      message: "Enter a positive quantity.",
    },
    ALREADY_REVERSED: {
      code: "CONFLICT",
      message: "This transaction has already been reversed.",
    },
    CANNOT_REVERSE_REVERSAL: {
      code: "CONFLICT",
      message: "A reversal cannot itself be reversed directly.",
    },
    REVERSAL_TARGET_NOT_FOUND: {
      code: "NOT_FOUND",
      message: "The transaction to reverse was not found.",
    },
    REVERSAL_DELTA_MISMATCH: {
      code: "CONFLICT",
      message: "The reversal must exactly negate the original transaction.",
    },
    REVERSAL_SCOPE_MISMATCH: {
      code: "CONFLICT",
      message: "The reversal must target the original transaction's lot.",
    },
    CROSS_LOCATION_REFERENCE: {
      code: "FORBIDDEN",
      message: "That record belongs to a different pantry location.",
    },
    HOUSEHOLD_NOT_FOUND: {
      code: "NOT_FOUND",
      message: "The household was not found or is unavailable.",
    },
    HOUSEHOLD_NOT_ELIGIBLE: {
      code: "CONFLICT",
      message: "This household is archived or merged and cannot receive new appointments.",
    },
    HOUSEHOLD_SIZE_INVALID: {
      code: "VALIDATION_ERROR",
      message: "Household size and member counts are inconsistent.",
    },
    APPOINTMENT_NOT_FOUND: {
      code: "NOT_FOUND",
      message: "The appointment was not found or is unavailable.",
    },
    APPOINTMENT_INVALID_STATE: {
      code: "CONFLICT",
      message: "This action is not valid for the appointment's current status.",
    },
    APPOINTMENT_TIME_INVALID: {
      code: "VALIDATION_ERROR",
      message: "The appointment start time must be before the end time.",
    },
    APPOINTMENT_ALREADY_CHECKED_IN: {
      code: "CONFLICT",
      message: "This appointment is already checked in.",
    },
    PACKAGE_TEMPLATE_NOT_FOUND: {
      code: "NOT_FOUND",
      message: "The package template was not found or is archived.",
    },
    PACKAGE_RULE_OVERLAP: {
      code: "CONFLICT",
      message: "An active size rule already covers part of that household-size range.",
    },
    ALLOCATION_NOT_FOUND: {
      code: "NOT_FOUND",
      message: "Generate the appointment allocation before reserving inventory.",
    },
    RESERVATION_NOT_FOUND: {
      code: "NOT_FOUND",
      message: "The reservation was not found or is no longer active.",
    },
    RESERVATION_ALREADY_EXISTS: {
      code: "CONFLICT",
      message: "An active reservation already exists for this appointment.",
    },
    RESERVATION_INSUFFICIENT_STOCK: {
      code: "CONFLICT",
      message: "Not enough available stock to reserve the required quantities.",
    },
    RESERVATION_INVALID_STATE: {
      code: "CONFLICT",
      message: "This action is not valid for the reservation's current status.",
    },
    FULFILLMENT_EXCEEDS_RESERVATION: {
      code: "CONFLICT",
      message: "The fulfilled quantity exceeds the reserved quantity for that line.",
    },
    FULFILLMENT_IMMUTABLE: {
      code: "CONFLICT",
      message: "Completed pickup records cannot be edited or deleted.",
    },
    FULFILLMENT_ALREADY_COMPLETED: {
      code: "CONFLICT",
      message: "This pickup has already been completed.",
    },
    SUBSTITUTION_NOT_ALLOWED: {
      code: "CONFLICT",
      message: "Substitution is not allowed for this line.",
    },
    SUBSTITUTION_DIETARY_CONFLICT: {
      code: "CONFLICT",
      message: "The substitute conflicts with a critical household restriction.",
    },
    CONSENT_INVALID: {
      code: "VALIDATION_ERROR",
      message: "A valid phone number is required to record consent.",
    },
  };

export function mapProviderError(
  error: ProviderError,
  requestId: string,
): ActionResult {
  const known = error.message ? safeMessages[error.message] : undefined;
  if (known) return { ok: false, ...known, requestId };
  if (error.code === "23505") {
    return {
      ok: false,
      code: "CONFLICT",
      message: "A record with those details already exists.",
      requestId,
    };
  }
  if (error.status === 429) {
    return {
      ok: false,
      code: "RATE_LIMITED",
      message: "Too many attempts. Wait a moment and try again.",
      requestId,
    };
  }
  return {
    ok: false,
    code: "INTERNAL_ERROR",
    message: "The operation could not be completed.",
    requestId,
  };
}

export function logServerError(
  scope: string,
  requestId: string,
  error: ProviderError,
) {
  console.error(scope, { requestId, code: error.code, status: error.status });
}
