// ---------------------------------------------------------------------------
// Result<T, E> — the only error-handling primitive in the pipeline.
// Stages return Result; they never throw across boundaries.
// ---------------------------------------------------------------------------

export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E = Error>(error: E): Result<never, E> => ({ ok: false, error });

export const map = <T, U, E>(
  r: Result<T, E>,
  fn: (v: T) => U,
): Result<U, E> => (r.ok ? ok(fn(r.value)) : r);

export const flatMap = <T, U, E>(
  r: Result<T, E>,
  fn: (v: T) => Result<U, E>,
): Result<U, E> => (r.ok ? fn(r.value) : r);

export const unwrapOr = <T>(r: Result<T>, fallback: T): T =>
  r.ok ? r.value : fallback;
