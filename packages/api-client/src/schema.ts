import type { ApiValidationIssue } from '@sakya/types';
import { ZodError } from 'zod';

import { ApiError } from './errors';

/**
 * The only part of a Zod schema this client depends on.
 *
 * Structural rather than `ZodType`, so the exact schemas from
 * `@sakya/validation` can be passed straight through without fighting Zod's
 * generics — and so a plain object with `parse` is a valid substitute in tests.
 */
export interface InputSchema<T> {
  parse: (value: unknown) => T;
}

function toIssues(error: ZodError): ApiValidationIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
    ...(typeof issue.code === 'string' ? { code: issue.code } : {}),
  }));
}

/**
 * Validate caller input with a schema shared with the API.
 *
 * The same schemas guard requests on both sides, so a form cannot accept input
 * the API will reject, and a rejected field is reported with the identical
 * message. Failures are rethrown as `ApiError`s with `code: 'VALIDATION_FAILED'`
 * so a caller handles client-side and server-side rejection identically.
 */
export function parseInput<T>(schema: InputSchema<T>, value: unknown, subject: string): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = toIssues(error);
      throw new ApiError({
        statusCode: 400,
        code: 'VALIDATION_FAILED',
        message: `${subject} failed validation (${issues.length} ${
          issues.length === 1 ? 'issue' : 'issues'
        }).`,
        issues,
      });
    }

    throw error;
  }
}
