import { AccessMatrix, DASHBOARD_CONFIG } from '@/pages/company/ReportAccess';

/** Admin: which dashboard widgets each role gets. */
export default function DashboardCustomize() {
  return <AccessMatrix config={DASHBOARD_CONFIG} />;
}
