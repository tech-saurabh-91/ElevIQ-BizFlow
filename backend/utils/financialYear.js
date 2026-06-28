const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_SHORT = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
];

/**
 * Get financial year info for a given date based on company's FY start.
 * @param {Date} date - The date to check
 * @param {{ month: number, day: number }} fyStart - FY start month/day (1-indexed)
 * @returns {{ fyLabel: string, fyYear: number, monthInFY: number, calendarMonth: number, calendarYear: number, quarter: string, startDate: Date, endDate: Date }}
 */
function getFinancialYear(date, fyStart) {
  const d = new Date(date);
  const calMonth = d.getMonth() + 1;
  const calYear = d.getFullYear();
  const calDay = d.getDate();

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

  const quarter = monthInFY <= 3 ? 'Q1' : monthInFY <= 6 ? 'Q2' : monthInFY <= 9 ? 'Q3' : 'Q4';

  const fyLabel = fyStartMonth === 1
    ? `${fyYear}`
    : `${fyYear}-${String(fyYear + 1).slice(-2)}`;

  return {
    fyLabel,
    fyYear,
    monthInFY,
    calendarMonth: calMonth,
    calendarYear: calYear,
    quarter,
    startDate,
    endDate,
  };
}

/**
 * Get the 12 FY months array for a given FY year.
 * @param {number} fyYear - The FY year (start year)
 * @param {{ month: number, day: number }} fyStart - FY start month/day
 * @returns {Array<{ monthInFY: number, calendarMonth: number, calendarYear: number, name: string, shortName: string, startDate: string, endDate: string }>}
 */
function getFYMonths(fyYear, fyStart) {
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
      shortName: MONTH_SHORT[calendarMonth - 1],
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    });
  }
  return months;
}

/**
 * Get current FY info from a company document.
 */
function getCurrentFY(company) {
  const fyStart = company.financialYearStart || { month: 1, day: 1 };
  return getFinancialYear(new Date(), fyStart);
}

module.exports = { getFinancialYear, getFYMonths, getCurrentFY, MONTH_NAMES, MONTH_SHORT };
