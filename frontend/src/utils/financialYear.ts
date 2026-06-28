const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function getFinancialYear(date: Date, fyStart: { month: number; day: number }) {
  const d = new Date(date);
  const calMonth = d.getMonth() + 1;
  const calYear = d.getFullYear();

  const fyStartMonth = fyStart.month;
  const fyStartDay = fyStart.day;

  let fyYear;
  if (fyStartMonth === 1 && fyStartDay === 1) {
    fyYear = calYear;
  } else {
    const fyStartDateThisYear = new Date(calYear, fyStartMonth - 1, fyStartDay);
    if (d >= fyStartDateThisYear) {
      fyYear = calYear;
    } else {
      fyYear = calYear - 1;
    }
  }

  const startDate = new Date(fyYear, fyStartMonth - 1, fyStartDay);
  const endYear = fyStartMonth === 1 ? fyYear : fyYear + 1;
  const endDate = new Date(endYear, fyStartMonth - 1, fyStartDay - 1);
  if (fyStartMonth === 1 && fyStartDay === 1) {
    endDate.setFullYear(fyYear + 1);
    endDate.setDate(endDate.getDate() - 1);
  }

  let monthInFY;
  if (fyStartMonth === 1) {
    monthInFY = calMonth;
  } else {
    monthInFY = ((calMonth - fyStartMonth + 12) % 12) + 1;
  }

  const fyLabel = fyStartMonth === 1
    ? `${fyYear}`
    : `${fyYear}-${String(fyYear + 1).slice(-2)}`;

  return { fyLabel, fyYear, monthInFY, startDate, endDate };
}

export function getFYMonths(fyYear: number, fyStart: { month: number; day: number }) {
  const months = [];
  for (let i = 0; i < 12; i++) {
    let calendarMonth, calendarYear;
    if (fyStart.month === 1) {
      calendarMonth = i + 1;
      calendarYear = fyYear;
    } else {
      calendarMonth = ((fyStart.month - 1 + i) % 12) + 1;
      calendarYear = fyStart.month - 1 + i < 12 ? fyYear : fyYear + 1;
    }
    const startDate = new Date(calendarYear, calendarMonth - 1, 1);
    const endDate = new Date(calendarYear, calendarMonth, 0);
    months.push({
      monthInFY: i + 1,
      calendarMonth,
      calendarYear,
      name: MONTH_NAMES[calendarMonth - 1],
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    });
  }
  return months;
}

export function getCurrentCalendarMonth() {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

export function canEditMonth(calendarMonth: number, calendarYear: number) {
  const now = new Date();
  const monthStart = new Date(calendarYear, calendarMonth - 1, 1);
  return monthStart >= new Date(now.getFullYear(), now.getMonth(), 1);
}
