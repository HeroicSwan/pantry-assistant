export type ActionErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string; requestId: string }
  | {
      ok: false;
      code: ActionErrorCode;
      message: string;
      fieldErrors?: Record<string, string[]>;
      requestId: string;
    };

export const initialActionResult: ActionResult = {
  ok: true,
  data: undefined,
  requestId: "initial",
};
