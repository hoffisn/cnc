/**
 * Outcome of an operation that can fail for a business reason.
 * Expected failures are values, so the compiler forces callers to handle them.
 *
 * @typeParam TValue - Payload of a successful outcome.
 * @typeParam TError - Description of a failed outcome.
 */
export type Result<TValue, TError> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: TError };

/** Wraps a value into a successful {@link Result}. */
export const ok = <TValue>(value: TValue): Result<TValue, never> => ({ ok: true, value });

/** Wraps an error description into a failed {@link Result}. */
export const err = <TError>(error: TError): Result<never, TError> => ({ ok: false, error });
