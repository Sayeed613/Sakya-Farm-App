import { BadRequestException } from '@nestjs/common';
import { paginationQuerySchema } from '@sakya/validation';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ZodValidationPipe } from '../src/common/pipes/zod-validation.pipe';

interface ValidationErrorBody {
  message: string;
  issues: { path: string; message: string; code?: string }[];
}

describe('ZodValidationPipe', () => {
  it('passes parsed output to the handler, including applied defaults', () => {
    const pipe = new ZodValidationPipe(paginationQuerySchema);

    // Untrusted query strings arrive as strings; the schema coerces and defaults.
    expect(pipe.transform({ page: '3' })).toEqual({ page: 3, perPage: 20 });
  });

  it('rejects invalid input with a 400 and reports every failing path', () => {
    const schema = z.object({
      email: z.string().email(),
      quantity: z.number().int().min(1),
    });
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ email: 'not-an-email', quantity: 0 });
      throw new Error('Expected the pipe to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);

      const body = (error as BadRequestException).getResponse() as ValidationErrorBody;
      expect(body.message).toContain('2 issues');
      expect(body.issues.map((issue) => issue.path).sort()).toEqual(['email', 'quantity']);
    }
  });

  it('maps nested paths with dot notation', () => {
    const schema = z.object({ items: z.array(z.object({ quantity: z.number().min(1) })) });
    const pipe = new ZodValidationPipe(schema);

    try {
      pipe.transform({ items: [{ quantity: 1 }, { quantity: 0 }] });
      throw new Error('Expected the pipe to throw');
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as ValidationErrorBody;
      expect(body.issues[0]?.path).toBe('items.1.quantity');
    }
  });

  it('strips unknown keys rather than passing them through', () => {
    const schema = z.object({ name: z.string() });
    const pipe = new ZodValidationPipe(schema);

    // Important for money: a client cannot smuggle an unexpected `price` field
    // past validation into a handler.
    expect(pipe.transform({ name: 'Rice', priceInPaise: 1 })).toEqual({ name: 'Rice' });
  });
});
