import { NextResponse } from 'next/server';
import { AppError } from './errors';
import { ZodError } from 'zod';

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

export function handleError(err: unknown): NextResponse {
  if (err instanceof AppError) {
    const res = NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.statusCode }
    );
    // Propagate server-computed Retry-After for restriction responses.
    const retryAfter =
      err.details && typeof err.details === 'object' && 'retryAfter' in err.details
        ? (err.details as Record<string, unknown>).retryAfter
        : undefined;
    if (typeof retryAfter === 'number') {
      res.headers.set('Retry-After', String(retryAfter));
    }
    return res;
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Validasi gagal', details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })) } },
      { status: 400 }
    );
  }
  console.error('[API Error]', err instanceof Error ? `${err.name}: ${err.message}` : 'unknown');
  return NextResponse.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan. Silakan coba lagi.' } },
    { status: 500 }
  );
}
