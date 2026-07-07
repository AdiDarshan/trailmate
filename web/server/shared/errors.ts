// Error taxonomy: internal errors carry full detail for logs; user-facing
// responses only ever see a `publicMessage`. Throw AppError when a message is
// safe (and useful) to show the user; anything else is logged and replaced
// with a generic message at the HTTP/stream boundary.

export class AppError extends Error {
  readonly publicMessage: string;

  constructor(message: string, opts?: { publicMessage?: string; cause?: unknown }) {
    super(message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "AppError";
    this.publicMessage = opts?.publicMessage ?? message;
  }
}

export const GENERIC_USER_ERROR = "Something went wrong. Please try again.";

/** The message safe to show a user for any thrown value. */
export function toPublicMessage(e: unknown, fallback: string = GENERIC_USER_ERROR): string {
  return e instanceof AppError ? e.publicMessage : fallback;
}
