import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import type { ApiValidationIssue } from '@sakya/types';
import type { z, ZodType } from 'zod';

/**
 * Validates a request payload against a Zod schema.
 *
 * Schemas come from `@sakya/validation` so the API and (later) the client apps
 * enforce identical rules. Validation failures become a 400 whose body lists
 * every failing path, which is what clients need to highlight form fields.
 *
 * Usage:
 * ```ts
 * @Get()
 * list(@Query(new ZodValidationPipe(paginationQuerySchema)) query: PaginationQuery) {}
 * ```
 *
 * Note that a schema's *output* is what reaches the handler: coercions and
 * defaults declared in the schema have already been applied, so handlers can
 * rely on the parsed type rather than the raw input.
 */
@Injectable()
export class ZodValidationPipe<TSchema extends ZodType> implements PipeTransform {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      const issues: ApiValidationIssue[] = result.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join('.'),
        message: issue.message,
        code: issue.code,
      }));

      throw new BadRequestException({
        message: `Request validation failed (${issues.length} issue${issues.length === 1 ? '' : 's'})`,
        issues,
      });
    }

    return result.data;
  }
}
