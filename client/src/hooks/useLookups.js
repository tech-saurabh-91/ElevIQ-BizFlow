import { useQuery } from '@tanstack/react-query';
import api from '@/api/client';

const EMPTY = {
  customers: [],
  products: [],
  suppliers: [],
  warehouses: [],
  routes: [],
  priceLists: [],
  users: [],
  categories: [],
  brands: [],
};

/**
 * Compact select options for every master (customers, products, users…).
 * Cached for a minute and shared by all master-data forms.
 */
export const useLookups = (options = {}) => {
  const { enabled = true, staleTime = 60_000 } = options;

  const query = useQuery({
    queryKey: ['company', 'lookups'],
    queryFn: async () => {
      const { data } = await api.get('/v1/lookups', { params: { limit: 200 } });
      return data?.data || EMPTY;
    },
    enabled,
    staleTime,
  });

  return { ...query, lookups: query.data || EMPTY };
};

export default useLookups;
