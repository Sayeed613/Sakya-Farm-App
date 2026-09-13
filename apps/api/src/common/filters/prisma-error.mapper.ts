import { HttpStatus } from '@nestjs/common';
import type { ApiErrorCode, ApiValidationIssue } from '@sakya/types';

import { Prisma } from '../../generated/prisma/client';

/**
 * Translates Prisma failures into HTTP responses.
 *
 * Kept as a pure function (no Nest coupling) so the mapping can be unit tested
 * directly and reused by background jobs that are not handling an HTTP request.
 *
 * Returning `null` means "not a database error I recognise", and the caller
 * falls back to a generic 500.
 */
export interface MappedDatabaseError {
  status: number;
  code: ApiErrorCode;
  message: string;
  issues?: ApiValidationIssue[];
}

/** Prisma `meta.target` is either a column name or a list of them. */
function normaliseTarget(target: unknown): string | null {
  if (typeof target === 'string') return target;
  if (Array.isArray(target) && target.length > 0) {
    return target.map((entry) => String(entry)).join(', ');
  }
  return null;
}

export function mapPrismaError(error: unknown): MappedDatabaseError | null {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    // The pool could not establish a connection at all.
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The database is unavailable. Please try again shortly.',
    };
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    // A malformed query means our code is wrong, not the caller's input.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    };
  }

  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return null;
  }

  const target = normaliseTarget(error.meta?.target);

  switch (error.code) {
    // Unique constraint violation.
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message:
          target === null
            ? 'A record with these values already exists'
            : `A record with this ${target} already exists`,
        ...(target !== null
          ? {
              issues: [
                {
                  path: target.split(', ')[0] ?? target,
                  message: 'This value is already in use',
                },
              ],
            }
          : {}),
      };

    // Foreign key constraint violation.
    case 'P2003':
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'This action conflicts with a related record',
      };

    // Required relation not connected / would break a required relation.
    case 'P2014':
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'This change would break a required relationship',
      };

    // Record required by the operation was not found.
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        code: 'NOT_FOUND',
        message: 'The requested record was not found',
      };

    // Value too long for the column.
    case 'P2000':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'BAD_REQUEST',
        message: target === null ? 'A value is too long' : `The value for ${target} is too long`,
      };

    // Null constraint violation on a required field.
    case 'P2011':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_FAILED',
        message: target === null ? 'A required value is missing' : `${target} is required`,
      };

    // Related record not found.
    case 'P2018':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'BAD_REQUEST',
        message: 'A referenced record does not exist',
      };

    default:
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      };
  }
}
