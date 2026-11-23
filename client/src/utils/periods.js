/** Date periods shared by the report viewer and statements (company FY aware). */

export const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const ymd = (x) =>
  `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;

/**
 * The "Period" list: quick months, then every financial year from the current
 * one back five years (the company's FY start - April in India), then Custom.
 */
export const periodOptions = (startMonth = 4) => {
  const d = new Date();
  const m = Number(startMonth) || 4;
  const fy = d.getMonth() + 1 >= m ? d.getFullYear() : d.getFullYear() - 1;
  const fyLabel = (y) => (m === 1 ? `FY ${y}` : `FY ${y}-${String(y + 1).slice(-2)}`);
  const quarterStart = new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
  const options = [
    { value: 'today', label: 'Today', range: [todayKey(), todayKey()] },
    { value: 'this-month', label: 'This month', range: [firstOfMonth(), todayKey()] },
    {
      value: 'last-month',
      label: 'Last month',
      range: [
        ymd(new Date(d.getFullYear(), d.getMonth() - 1, 1)),
        ymd(new Date(d.getFullYear(), d.getMonth(), 0)),
      ],
    },
    { value: 'this-quarter', label: 'This quarter', range: [ymd(quarterStart), todayKey()] },
  ];
  for (let y = fy; y > fy - 6; y -= 1) {
    const to = y === fy ? todayKey() : ymd(new Date(y + 1, m - 1, 0));
    options.push({
      value: `fy-${y}`,
      label: `${fyLabel(y)}${y === fy ? ' (this year)' : y === fy - 1 ? ' (last year)' : ''}`,
      range: [`${y}-${String(m).padStart(2, '0')}-01`, to],
      group: 'Financial year',
    });
  }
  return options;
};
