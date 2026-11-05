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

/**
 * Business-date rules shared by the validators. A 'YYYY-MM-DD' parses as UTC
 * midnight, so "not in the future" allows 14 h of slack for the company's
 * time zone (the browser enforces the exact calendar day).
 */
export const notFutureDate = (v) => !v || Number.isNaN(Date.parse(v)) || Date.parse(v) <= Date.now() + 14 * 3600000;

/** superRefine: `later` must not be before `earlier` (both optional). */
export const dateNotBefore = (later, earlier, message) => (v, ctx) => {
  if (!v?.[later] || !v?.[earlier]) return;
  const a = Date.parse(v[later]);
  const b = Date.parse(v[earlier]);
  if (!Number.isNaN(a) && !Number.isNaN(b) && a < b) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [later], message });
};

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
