import type { Request, Response, NextFunction } from 'express';
import { z, type ZodType } from 'zod/v4';

interface ValidationTarget {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

const validators = new WeakSet<object>();

/** The role walk sends a route with a validator input it refuses, so its handler never runs. */
export function isValidator(handler: unknown): boolean {
  return typeof handler === 'function' && validators.has(handler);
}

export function validate(schema: ValidationTarget) {
  const check = (req: Request, res: Response, next: NextFunction): void => {
    if (schema.params) {
      const result = schema.params.safeParse(req.params);
      if (!result.success) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: z.prettifyError(result.error) },
        });
        return;
      }
      req.params = result.data as typeof req.params;
    }

    if (schema.query) {
      const result = schema.query.safeParse(req.query);
      if (!result.success) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: z.prettifyError(result.error) },
        });
        return;
      }
      // Express 5 exposes req.query as a getter, so plain assignment throws.
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }

    if (schema.body) {
      const result = schema.body.safeParse(req.body);
      if (!result.success) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: z.prettifyError(result.error) },
        });
        return;
      }
      req.body = result.data;
    }

    next();
  };
  validators.add(check);
  return check;
}
