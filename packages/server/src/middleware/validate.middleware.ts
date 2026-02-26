// ===========================================
// Validation Middleware
// ===========================================
// Validates req.body, req.query, and/or req.params against Zod schemas.
// On success, replaces the request data with parsed (coerced, defaulted) values.
// On failure, returns 400 with prettified Zod error.

import type { Request, Response, NextFunction } from 'express';
import { z, type ZodType } from 'zod/v4';

interface ValidationTarget {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validate(schema: ValidationTarget) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (schema.params) {
      const result = schema.params.safeParse(req.params);
      if (!result.success) {
        res.status(400).json({
          success: false,
          error: z.prettifyError(result.error),
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
          error: z.prettifyError(result.error),
        });
        return;
      }
      req.query = result.data as typeof req.query;
    }

    if (schema.body) {
      const result = schema.body.safeParse(req.body);
      if (!result.success) {
        res.status(400).json({
          success: false,
          error: z.prettifyError(result.error),
        });
        return;
      }
      req.body = result.data;
    }

    next();
  };
}
