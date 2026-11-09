import api from '@/api/client';

/** Home screen numbers; shared by the page and the start-up prefetch. */
export const DASHBOARD_KEY = ['company', 'dashboard'];

export const fetchDashboardSummary = async () => {
  const { data } = await api.get('/v1/dashboard/summary');
  return data?.data;
};
