export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const notFound = (msg = "Not found") => new AppError(404, "not_found", msg);
export const conflict = (msg: string, details?: unknown) => new AppError(409, "conflict", msg, details);
export const forbidden = (msg = "Forbidden") => new AppError(403, "forbidden", msg);
export const unauthorized = (msg = "Authentication required") => new AppError(401, "unauthorized", msg);
