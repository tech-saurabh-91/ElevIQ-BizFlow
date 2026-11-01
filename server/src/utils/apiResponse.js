/**
 * Consistent API response helpers.
 * Success: { success, message, data, meta }
 * Error:   { success:false, code, message, errors[] }
 */

export const success = (res, { message = 'OK', data = null, meta = null, status = 200 }) => {
  const body = { success: true, message };
  if (data !== undefined && data !== null) body.data = data;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};

export const created = (res, { message = 'Created', data = null, meta = null }) =>
  success(res, { message, data, meta, status: 201 });

export const noContent = (res) => res.status(204).end();

export const paginated = (res, { message = 'OK', data = [], page = 1, limit = 20, total = 0, extra = {} }) =>
  success(res, {
    message,
    data,
    meta: { page: Number(page), limit: Number(limit), total: Number(total), pages: Math.ceil((total || 0) / (limit || 1) || 0), ...extra },
  });

export default { success, created, noContent, paginated };
