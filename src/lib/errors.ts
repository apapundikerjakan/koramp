export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}
export class ValidationError extends AppError {
  constructor(m: string, d?: unknown) { super(400, 'VALIDATION_ERROR', m, d); }
}
export class NotFoundError extends AppError {
  constructor(m = 'Tidak ditemukan') { super(404, 'NOT_FOUND', m); }
}
export class ForbiddenError extends AppError {
  constructor(m = 'Akses ditolak') { super(403, 'FORBIDDEN', m); }
}
export class AuthError extends AppError {
  constructor(m = 'Unauthorized') { super(401, 'UNAUTHORIZED', m); }
}
export class ConflictError extends AppError {
  constructor(m: string) { super(409, 'CONFLICT', m); }
}
export class OrderStateError extends AppError {
  constructor(m: string) { super(422, 'INVALID_ORDER_STATE', m); }
}
