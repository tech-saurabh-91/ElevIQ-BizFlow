/**
 * Amount in words for printed documents, e.g.
 *   INR 1,25,050.50 -> "Rupees One Lakh Twenty Five Thousand Fifty and Fifty Paise Only"
 *   KES 300,000     -> "Kenya Shillings Three Hundred Thousand Only"
 * Indian rupees use the lakh / crore system; every other currency the
 * international thousand / million / billion one.
 */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

const CURRENCIES = {
  INR: ['Rupees', 'Paise'],
  KES: ['Kenya Shillings', 'Cents'],
  UGX: ['Uganda Shillings', 'Cents'],
  TZS: ['Tanzania Shillings', 'Cents'],
  USD: ['US Dollars', 'Cents'],
  AED: ['UAE Dirhams', 'Fils'],
  SAR: ['Saudi Riyals', 'Halalas'],
  OMR: ['Omani Rials', 'Baisa'],
  QAR: ['Qatari Riyals', 'Dirhams'],
  KWD: ['Kuwaiti Dinars', 'Fils'],
  BHD: ['Bahraini Dinars', 'Fils'],
  GBP: ['Pounds', 'Pence'],
  EUR: ['Euros', 'Cents'],
  NPR: ['Nepalese Rupees', 'Paisa'],
  LKR: ['Sri Lankan Rupees', 'Cents'],
  BDT: ['Taka', 'Poisha'],
  PKR: ['Pakistani Rupees', 'Paisa'],
  ZAR: ['Rand', 'Cents'],
  NGN: ['Naira', 'Kobo'],
};

const below100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
const below1000 = (n) => {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? below100(rest) : ''].filter(Boolean).join(' ');
};

const indian = (n) => {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${indian(crore)} Crore`);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(' ');
};

const international = (n) => {
  if (n === 0) return 'Zero';
  const scales = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];
  const parts = [];
  let i = 0;
  while (n > 0 && i < scales.length) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(`${below1000(chunk)}${scales[i] ? ` ${scales[i]}` : ''}`);
    n = Math.floor(n / 1000);
    i += 1;
  }
  return parts.join(' ');
};

export const amountInWords = (amount, currency = 'INR') => {
  const value = Math.round(Math.abs(Number(amount || 0)) * 100);
  const whole = Math.floor(value / 100);
  const fraction = value % 100;
  const code = String(currency || '').toUpperCase();
  const [major, minor] = CURRENCIES[code] || [code || '', 'Cents'];
  const say = code === 'INR' ? indian : international;
  const words = `${say(whole)}${fraction ? ` and ${below100(fraction)} ${minor}` : ''}`;
  return `${code === 'INR' ? `${major} ${words}` : `${major} ${words}`} Only`.replace(/\s+/g, ' ').trim();
};

export default amountInWords;
