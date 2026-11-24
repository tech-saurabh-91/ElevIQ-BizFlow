import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Customer portal state - entirely separate from the staff session
 * (store/authStore.js), so a staff login and a customer login in the same
 * browser never overwrite each other.
 *
 * Kept: the signed-in session (minus the access token, which stays in memory)
 * and one cart per company code. The refresh token is an httpOnly cookie on
 * /api/portal that JS never sees.
 */
const NO_ITEMS = [];

export const usePortalStore = create(
  persist(
    (set, get) => ({
      accessToken: null,
      session: null, // { account, customer, company, portal }
      carts: {}, // { [companyCode]: [{ product, name, unit, qty, price, image }] }

      setSession: ({ accessToken, account, customer, company, portal }) =>
        set({ accessToken, session: { account, customer, company, portal } }),
      patchAccount: (patch) => {
        const s = get().session;
        if (s) set({ session: { ...s, account: { ...s.account, ...patch } } });
      },
      clear: () => set({ accessToken: null, session: null }),

      cartOf: (code) => get().carts[String(code || '').toUpperCase()] || NO_ITEMS,
      setCart: (code, items) =>
        set({ carts: { ...get().carts, [String(code || '').toUpperCase()]: items } }),
    }),
    {
      name: 'eleviq_portal',
      version: 1,
      partialize: (s) => ({ session: s.session, carts: s.carts }),
    }
  )
);

const keyOf = (line) => `${line.product}|${line.unit}`;

/** Cart helpers bound to one company code. */
export const cartActions = (code) => {
  const store = usePortalStore.getState;
  const items = () => store().cartOf(code);
  const save = (next) => store().setCart(code, next.filter((l) => Number(l.qty) > 0));
  return {
    setQty: (line, qty) => {
      const list = items();
      const at = list.findIndex((l) => keyOf(l) === keyOf(line));
      if (at === -1) save([...list, { ...line, qty }]);
      else save(list.map((l, i) => (i === at ? { ...l, ...line, qty } : l)));
    },
    remove: (line) => save(items().filter((l) => keyOf(l) !== keyOf(line))),
    replace: (lines) => save(lines),
    clear: () => store().setCart(code, []),
  };
};

export default usePortalStore;
