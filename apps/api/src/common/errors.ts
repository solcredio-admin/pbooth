import { HttpException, HttpStatus } from "@nestjs/common";

// Every error the API returns has the same shape:
//   { "error": { "code": "EVENT_NOT_FOUND", "message": "...", "details": [...] } }
// so the web app only needs one way to read failures.
export class ApiError extends HttpException {
  constructor(status: HttpStatus, readonly code: string, message: string, readonly details?: unknown) {
    super({ error: { code, message, ...(details === undefined ? {} : { details }) } }, status);
  }
}

export const notFound = (what: string) => new ApiError(HttpStatus.NOT_FOUND, "NOT_FOUND", `${what} not found`);
