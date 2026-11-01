/**
 * Central Zod validation middleware.
 * Usage: validate({ body: z.object({...}) })
 *       validate({ query: z.object({...}) })
 *       validate({ params: z.object({...}) })
 *
 * Replaces req.body/query/params with the parsed (and coerced) values so
 * downstream code only ever sees validated, correctly-typed data.
 */
import { z } from 'zod';
import { ValidationError } from '../utils/errors.js';

// Reusable primitives -------------------------------------------------------
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, { message: 'Invalid id' });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
  sort: z.string().optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(200).optional(),
});

const formatZodError = (error) =>
  error.issues.map((i) => ({
    field: i.path.join('.') || '_',
    message: i.message,
    code: i.code,
  }));

const parseInto = (schema, value, location, errors) => {
  if (!schema) return undefined;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    errors.push(...formatZodError(result.error).map((e) => ({ ...e, location })));
    return undefined;
  }
  return result.data;
};

export const validate =
  ({ body, query, params, headers } = {}) =>
  (req, _res, next) => {
    const errors = [];

    const parsedBody = parseInto(body, req.body, 'body', errors);
    const parsedQuery = parseInto(query, req.query, 'query', errors);
    const parsedParams = parseInto(params, req.params, 'params', errors);
    const parsedHeaders = parseInto(headers, req.headers, 'headers', errors);

    if (errors.length) {
      return next(new ValidationError('Validation failed', errors));
    }

    if (body) req.body = parsedBody;
    if (query) req.query = parsedQuery;
    if (params) req.params = parsedParams;
    if (headers && parsedHeaders) req.headers = { ...req.headers, ...parsedHeaders };

    next();
  };

export { z };
export default validate;
