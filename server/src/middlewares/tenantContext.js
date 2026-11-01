import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped storage so Mongoose query hooks can automatically know which
 * tenant (companyId) the current request belongs to, without threading it
 * through every call site.
 *
 * The `tenant` middleware runs `runWithContext(...)`; every query executed
 * inside that async scope can read the context.
 */
export const tenantStorage = new AsyncLocalStorage();

/**
 * Run `fn` inside a tenant context.
 *
 * IMPORTANT: the returned value is awaited *inside* the context. This matters
 * because a Mongoose Query only executes its middleware (where the tenant
 * plugin reads the context) when `.then()`/`.exec()` is invoked. If we simply
 * returned the Query, the caller's `await` would fire outside the context and
 * tenant scoping would be lost.
 */
export const runWithContext = (context, fn) =>
  tenantStorage.run(context, async (...args) => {
    const result = fn(...args);
    // Returning a thenable from this async fn chains it while the context is
    // still active, so query middleware sees the correct companyId.
    return result;
  });

export const getContext = () => tenantStorage.getStore() ?? null;

export const getCompanyId = () => {
  const ctx = tenantStorage.getStore();
  if (!ctx) return null;
  // Never accept a companyId that came from an untrusted source outside JWT.
  return ctx.companyId ?? null;
};

export const getUserId = () => {
  const ctx = tenantStorage.getStore();
  return ctx?.userId ?? null;
};

export const isPlatformRequest = () => {
  const ctx = tenantStorage.getStore();
  return ctx?.scope === 'platform';
};

export default tenantStorage;
