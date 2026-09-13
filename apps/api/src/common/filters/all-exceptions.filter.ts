import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { ApiErrorCode, ApiErrorResponse, ApiValidationIssue } from '@sakya/types';
import type { Response } from 'express';

import { mapPrismaError } from './prisma-error.mapper';
import type { AuthenticatedRequest } from '../types/authenticated-user';

/**
 * The single place every failed request is turned into a response body.
 *
 * Having one filter (rather than a chain of type-specific ones) removes any
 * ambiguity about which filter wins, and guarantees the same shape everywhere:
 *
 * ```json
 * {
 *   "success": false,
 *   "statusCode": 400,
 *   "code": "VALIDATION_FAILED",
 *   "message": "...",
 *   "issues": [{ "path": "quantity", "message": "..." }],
 *   "requestId": "...",
 *   "path": "/api/v1/cart/items",
 *   "timestamp": "..."
 * }
 * ```
 *
 * Internal failure details are logged but never returned to the caller.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionHandler');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<AuthenticatedRequest>();
    const response = context.getResponse<Response>();

    const { body, logLevel } = this.buildResponse(exception, request);

    const summary = `${request.method} ${request.url} -> ${body.statusCode} ${body.code}`;
    const context_ = `requestId=${request.requestId ?? 'unknown'}`;

    if (logLevel === 'error') {
      this.logger.error(
        `${summary} (${context_})`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.debug(`${summary} (${context_}) ${body.message}`);
    }

    response.status(body.statusCode).json(body);
  }

  private buildResponse(
    exception: unknown,
    request: AuthenticatedRequest,
  ): { body: ApiErrorResponse; logLevel: 'error' | 'debug' } {
    const base = {
      success: false as const,
      requestId: request.requestId,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const { message, issues, code } = this.readHttpException(exception, status);
      return {
        body: {
          ...base,
          statusCode: status,
          code,
          message,
          ...(issues !== undefined ? { issues } : {}),
        },
        logLevel: status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'error' : 'debug',
      };
    }

    const databaseError = mapPrismaError(exception);
    if (databaseError !== null) {
      return {
        body: {
          ...base,
          statusCode: databaseError.status,
          code: databaseError.code,
          message: databaseError.message,
          ...(databaseError.issues !== undefined ? { issues: databaseError.issues } : {}),
        },
        logLevel: databaseError.status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'error' : 'debug',
      };
    }

    // Anything reaching here is an unhandled bug. Log it in full, tell the
    // caller nothing about it.
    return {
      body: {
        ...base,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
      logLevel: 'error',
    };
  }

  private readHttpException(
    exception: HttpException,
    status: number,
  ): { message: string; issues?: ApiValidationIssue[]; code: ApiErrorCode } {
    const payload = exception.getResponse();
    let message = exception.message;
    let issues: ApiValidationIssue[] | undefined;

    if (typeof payload === 'string') {
      message = payload;
    } else if (typeof payload === 'object' && payload !== null) {
      const record = payload as Record<string, unknown>;

      if (typeof record.message === 'string') {
        message = record.message;
      } else if (Array.isArray(record.message)) {
        // Nest's own ValidationPipe reports an array of messages.
        message = record.message.map((entry) => String(entry)).join('; ');
      }

      if (Array.isArray(record.issues)) {
        issues = record.issues as ApiValidationIssue[];
      }
    }

    // ZodValidationPipe attaches `issues`; that is a validation failure
    // regardless of the HTTP status it was raised with.
    const code: ApiErrorCode =
      issues !== undefined && issues.length > 0 ? 'VALIDATION_FAILED' : codeForStatus(status);

    return { message, issues, code };
  }
}

function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHENTICATED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'VALIDATION_FAILED';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'RATE_LIMITED';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'SERVICE_UNAVAILABLE';
    default:
      return status >= HttpStatus.INTERNAL_SERVER_ERROR ? 'INTERNAL_ERROR' : 'BAD_REQUEST';
  }
}
