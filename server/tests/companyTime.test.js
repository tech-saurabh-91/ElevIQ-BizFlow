/**
 * "Today" and "this month" follow the company's timezone, not the server's
 * (UTC). Between midnight and 05:30 IST the server is still on yesterday.
 */
describe('Company time', () => {
  test('just after midnight in India it is already the next day and month', async () => {
    const { companyToday } = await import('../src/utils/companyTime.js');
    const now = new Date('2026-10-31T19:00:00Z'); // 1 Nov 2026, 00:30 IST
    const t = companyToday('Asia/Kolkata', now);
    expect(t.key).toBe('2026-11-01');
    expect(t.today.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(t.tomorrow.toISOString()).toBe('2026-11-01T18:30:00.000Z');
    expect(t.monthStart.toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  test('report windows are whole company days', async () => {
    const { resolveWindow } = await import('../src/services/reportService.js');
    const w = resolveWindow({ dateFrom: '2026-11-01', dateTo: '2026-11-01' }, { tz: 'Asia/Kolkata' });
    expect(w.from.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(w.to.toISOString()).toBe('2026-11-01T18:29:59.999Z');
    expect(w.fromIso).toBe('2026-11-01');
    const d = resolveWindow({}, { tz: 'Asia/Kolkata', defaultDays: 7 });
    expect(Math.round((d.to - d.from) / 86400000)).toBe(7);
  });
});
