#!/usr/bin/env node
/**
 * Create a ready-to-show demo company ("Shree Ganesh Traders", an FMCG
 * distributor in Pune) through the public API of a running ElevIQ server.
 *
 * Everything goes through the normal endpoints, so every validation and
 * business rule applies exactly as it does for a real user. Safe to run again:
 * it reuses what already exists (matched by code / name) instead of duplicating.
 *
 * Usage (PowerShell):
 *   $env:API_BASE="https://elev-iq-biz-flow.vercel.app"
 *   $env:PLATFORM_EMAIL="superadmin@..."; $env:PLATFORM_PASSWORD="..."
 *   $env:DEMO_ADMIN_PASSWORD="Strong#Admin1"; $env:DEMO_TEAM_PASSWORD="Strong#Team1"
 *   node scripts/seed-demo-company.mjs
 *
 * Optional:
 *   DEMO_COMPANY_CODE   company code             (default SGT01)
 *   DEMO_EMAIL_DOMAIN   domain of demo logins    (default example.com - nothing
 *                       is delivered there; use a domain you own to get mails)
 *   DEMO_PLAN           STARTER | GROWTH | ENTERPRISE (default GROWTH)
 *   DRY_RUN=1           only check the connection and the platform sign-in
 *
 * Logins created (password = DEMO_ADMIN_PASSWORD / DEMO_TEAM_PASSWORD):
 *   rohan@<domain>  admin      sneha@<domain>  manager     amit@<domain>  salesman
 *   pooja@<domain>  van sales  vikas@<domain>  accountant  ganesh@<domain> store keeper
 */

const env = (k, d) => (process.env[k] ?? d ?? '').trim();
const API = env('API_BASE').replace(/\/+$/, '');
const CODE = env('DEMO_COMPANY_CODE', 'SGT01').toUpperCase();
const DOMAIN = env('DEMO_EMAIL_DOMAIN', 'example.com').toLowerCase();
const PLAN = env('DEMO_PLAN', 'GROWTH').toUpperCase();
const ADMIN_PW = env('DEMO_ADMIN_PASSWORD');
const TEAM_PW = env('DEMO_TEAM_PASSWORD');
const DRY = env('DRY_RUN') === '1';

const strong = (p) => p.length >= 8 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p);
const missing = ['API_BASE', 'PLATFORM_EMAIL', 'PLATFORM_PASSWORD', 'DEMO_ADMIN_PASSWORD', 'DEMO_TEAM_PASSWORD'].filter((k) => !env(k));
if (missing.length) {
  console.error(`Set these environment variables first: ${missing.join(', ')}`);
  process.exit(1);
}
if (!strong(ADMIN_PW) || !strong(TEAM_PW)) {
  console.error('DEMO_ADMIN_PASSWORD and DEMO_TEAM_PASSWORD need 8+ characters with upper, lower, a number and a symbol.');
  process.exit(1);
}

// ---------------------------------------------------------------- helpers
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const mail = (user) => `${user}@${DOMAIN}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;

async function call(method, path, { token, body } = {}) {
  calls += 1;
  if (calls % 40 === 0) await sleep(1500); // stay well under the API rate limit
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json };
}

const fail = (what, r) => {
  const errs = (r.body?.errors || []).map((e) => `${e.field}: ${e.message}`).join('; ');
  throw new Error(`${what} failed (${r.status}) ${r.body?.message || ''} ${errs}`);
};
const must = async (what, method, path, opts) => {
  const r = await call(method, path, opts);
  if (r.status >= 300) fail(what, r);
  console.log(`  ok  ${what}`);
  return r.body?.data;
};
const list = async (path, token) => (await call('GET', `${path}${path.includes('?') ? '&' : '?'}limit=200`, { token })).body?.data || [];

/** Sign in a company user; on the first sign-in replace the start password with `finalPw`. */
async function signIn(email, firstPw, finalPw) {
  let r = await call('POST', '/api/auth/login', { body: { identifier: email, password: finalPw } });
  if (r.status === 200 && !r.body.data.user.mustChangePassword) return r.body.data.accessToken;
  if (r.status !== 200) r = await call('POST', '/api/auth/login', { body: { identifier: email, password: firstPw } });
  if (r.status !== 200) fail(`sign in ${email}`, r);
  if (r.body.data.user.mustChangePassword) {
    const pw = firstPw === finalPw ? `${finalPw}!` : finalPw;
    const c = await call('POST', '/api/auth/change-password', { token: r.body.data.accessToken, body: { currentPassword: firstPw, newPassword: pw } });
    if (c.status >= 300) fail(`first password change for ${email}`, c);
    r = await call('POST', '/api/auth/login', { body: { identifier: email, password: pw } });
    if (r.status !== 200) fail(`sign in ${email}`, r);
    if (pw !== finalPw) console.log(`  note ${email} password is "${finalPw}!" (the start and final password cannot be the same)`);
  }
  return r.body.data.accessToken;
}

// ---------------------------------------------------------------- 1. platform
console.log(`\nElevIQ demo company -> ${API}`);
const health = await fetch(`${API}/health`).catch(() => null);
if (!health?.ok) throw new Error(`Cannot reach ${API}/health`);
const pl = await call('POST', '/api/platform/auth/login', { body: { email: env('PLATFORM_EMAIL'), password: env('PLATFORM_PASSWORD') } });
if (pl.status !== 200) fail('platform sign-in', pl);
const P = pl.body.data.accessToken;
console.log('  ok  platform sign-in');
if (DRY) {
  console.log('DRY_RUN=1: connection and sign-in work, nothing was created.');
  process.exit(0);
}

console.log('\n1. Company');
const existing = (await list(`/api/platform/companies?search=${CODE}`, P)).find((c) => c.code === CODE);
const START_PW = `${ADMIN_PW}#1`; // the platform's first password; replaced at the admin's first sign-in
if (existing) {
  console.log(`  skip company ${CODE} already exists (${existing.name || existing.businessName})`);
} else {
  const plans = await list('/api/platform/plans', P);
  const plan = plans.find((x) => x.code === PLAN);
  if (!plan) throw new Error(`Plan ${PLAN} not found`);
  await must(`company ${CODE} Shree Ganesh Traders (${PLAN}, paid)`, 'POST', '/api/platform/companies', {
    token: P,
    body: {
      businessName: 'Shree Ganesh Traders',
      legalName: 'Shree Ganesh Traders Private Limited',
      code: CODE,
      businessType: 'BOTH',
      email: mail('accounts'),
      phone: '+91 98220 45781',
      website: 'https://shreeganeshtraders.in',
      gstin: '27AAKCS4821M1ZQ',
      address: { line1: 'Shop 14, Market Yard, Gultekdi', line2: 'Near APMC Gate No. 3', city: 'Pune', state: 'Maharashtra', country: 'India', pincode: '411037' },
      planId: plan.id,
      startMode: 'PAID',
      modules: { purchase: true },
      admin: { name: 'Rohan Deshmukh', email: mail('rohan'), phone: '+91 98220 45782', title: 'Managing Director', password: START_PW },
    },
  });
}
const T = await signIn(mail('rohan'), START_PW, ADMIN_PW);
const A = { token: T };
console.log('  ok  admin signed in');

// ---------------------------------------------------------------- 2. settings & warehouses
console.log('\n2. Settings & warehouses');
await must('invoice, order and field settings', 'PATCH', '/api/v1/settings', {
  ...A,
  body: {
    displayName: 'Shree Ganesh Traders',
    invoice: {
      terms: '1. Goods once sold will not be taken back.\n2. Interest @18% p.a. on payments delayed beyond the due date.\n3. Subject to Pune jurisdiction.',
      footerNote: 'Thank you for your business!',
      defaultDueDays: 15,
      upiVpa: 'shreeganeshtraders@hdfcbank',
      showQr: true,
    },
    order: { approvalThreshold: 50000, creditLimitAction: 'WARN' },
    fieldForce: { workStart: '09:30', workEnd: '19:00', geofenceRadiusM: 150 },
  },
});
const godownAddress = { line1: 'Gala No. 7, Market Yard Road', line2: 'Gultekdi', city: 'Pune', state: 'Maharashtra', country: 'India', pincode: '411037' };
const warehouses = await list('/api/v1/warehouses', T);
let main = warehouses.find((w) => w.type === 'MAIN');
if (!main) main = await must('main godown', 'POST', '/api/v1/warehouses', { ...A, body: { name: 'Gultekdi Main Godown', code: 'GDN01', type: 'MAIN', address: godownAddress } });
else if (main.name !== 'Gultekdi Main Godown') await must('main godown details', 'PATCH', `/api/v1/warehouses/${main.id}`, { ...A, body: { name: 'Gultekdi Main Godown', address: godownAddress, phone: '+91 98220 45781' } });
const wh = async (code, body) => warehouses.find((w) => w.code === code) || must(`warehouse ${body.name}`, 'POST', '/api/v1/warehouses', { ...A, body: { code, ...body } });
const sub = await wh('HDPGDN', {
  name: 'Hadapsar Sub Godown', type: 'SUB', parent: main.id, phone: '+91 98220 45785',
  address: { line1: 'Plot 22, Industrial Estate', line2: 'Hadapsar', city: 'Pune', state: 'Maharashtra', country: 'India', pincode: '411028' },
});
const van = await wh('VAN01', { name: 'Delivery Van - MH12 RK 4521', type: 'VAN', parent: main.id, vehicleNumber: 'MH12RK4521', vehicleType: 'Tata Ace Gold' });

// ---------------------------------------------------------------- 3. catalogue
console.log('\n3. Units, categories & products');
const units = await list('/api/v1/units', T);
for (const [code, name] of [['CTN', 'Carton'], ['PKT', 'Packet'], ['JAR', 'Jar']]) {
  if (!units.some((u) => u.code === code)) await must(`unit ${code}`, 'POST', '/api/v1/units', { ...A, body: { code, name } });
}
const tree = {
  'Food & Beverages': ['Dairy', 'Edible Oil', 'Biscuits & Snacks', 'Beverages', 'Staples', 'Instant Food'],
  'Personal Care': ['Bath Soaps', 'Hair Care', 'Oral Care'],
  'Home Care': ['Detergents', 'Dishwash'],
};
const cats = await list('/api/v1/product-categories', T);
const catId = {};
const category = async (level, name, parent) => {
  const found = cats.find((x) => x.name === name && x.level === level);
  if (found) return found.id;
  const d = await must(`category ${name}`, 'POST', '/api/v1/product-categories', { ...A, body: { level, name, parent } });
  return d.id;
};
for (const [cls, children] of Object.entries(tree)) {
  catId[cls] = await category('CLASSIFICATION', cls);
  for (const c of children) catId[c] = await category('CATEGORY', c, catId[cls]);
}
const F = 'Food & Beverages';
const PC = 'Personal Care';
const HC = 'Home Care';
const productRows = [
  // name, brand, classification, category, HSN, GST%, MRP, selling, dealer, purchase, opening stock, carton size
  ['Amul Butter 500g', 'Amul', F, 'Dairy', '0405', 12, 285, 275, 265, 255, 120, 20],
  ['Amul Taaza Toned Milk 1L', 'Amul', F, 'Dairy', '0401', 5, 74, 72, 70, 67, 200, 12],
  ['Fortune Sunflower Oil 1L', 'Fortune', F, 'Edible Oil', '1512', 5, 175, 168, 162, 155, 150, 10],
  ['Fortune Kachi Ghani Mustard Oil 1L', 'Fortune', F, 'Edible Oil', '1514', 5, 190, 182, 176, 168, 90, 10],
  ['Parle-G Biscuits 800g', 'Parle', F, 'Biscuits & Snacks', '1905', 18, 90, 86, 83, 79, 240, 24],
  ['Britannia Good Day Cashew 600g', 'Britannia', F, 'Biscuits & Snacks', '1905', 18, 150, 144, 139, 132, 110, 12],
  ["Haldiram's Aloo Bhujia 1kg", "Haldiram's", F, 'Biscuits & Snacks', '2106', 12, 260, 248, 240, 228, 80, 10],
  ['Tata Tea Premium 1kg', 'Tata', F, 'Beverages', '0902', 5, 560, 540, 525, 505, 70, 10],
  ['Nescafe Classic Coffee 200g', 'Nescafe', F, 'Beverages', '2101', 18, 640, 615, 598, 575, 45, 6],
  ['Aashirvaad Whole Wheat Atta 10kg', 'Aashirvaad', F, 'Staples', '1101', 5, 520, 498, 485, 465, 60, 0],
  ['India Gate Basmati Rice 5kg', 'India Gate', F, 'Staples', '1006', 5, 750, 718, 699, 668, 40, 0],
  ['Tata Salt 1kg', 'Tata', F, 'Staples', '2501', 0, 28, 27, 26, 24, 300, 25],
  ['Maggi 2-Minute Noodles 12-pack', 'Maggi', F, 'Instant Food', '1902', 18, 168, 160, 155, 147, 100, 8],
  ['Dettol Original Soap 125g x4', 'Dettol', PC, 'Bath Soaps', '3401', 18, 210, 199, 192, 182, 130, 12],
  ['Lux Soft Touch Soap 100g x4', 'Lux', PC, 'Bath Soaps', '3401', 18, 170, 162, 156, 148, 140, 12],
  ['Clinic Plus Shampoo 650ml', 'Clinic Plus', PC, 'Hair Care', '3305', 18, 410, 392, 380, 362, 60, 6],
  ['Parachute Coconut Oil 600ml', 'Parachute', PC, 'Hair Care', '1513', 5, 265, 254, 246, 234, 75, 12],
  ['Colgate Strong Teeth 200g', 'Colgate', PC, 'Oral Care', '3306', 18, 125, 119, 115, 109, 140, 24],
  ['Surf Excel Easy Wash 1kg', 'Surf Excel', HC, 'Detergents', '3402', 18, 140, 134, 129, 122, 160, 12],
  ['Vim Dishwash Bar 300g x3', 'Vim', HC, 'Dishwash', '3402', 18, 90, 86, 83, 78, 180, 24],
];
const existingProducts = await list('/api/v1/products', T);
const pid = {};
for (const [name, brand, cls, cat, hsn, gst, mrp, sp, dealer, pur, stock, ctn] of productRows) {
  const found = existingProducts.find((x) => x.name === name);
  if (found) {
    pid[name] = found.id;
    continue;
  }
  const d = await must(`product ${name}`, 'POST', '/api/v1/products', {
    ...A,
    body: {
      name, brand, classificationId: catId[cls], categoryId: catId[cat], hsnCode: hsn, gstRate: gst, unit: 'PCS',
      mrp, sellingPrice: sp, dealerPrice: dealer, purchasePrice: pur,
      openingStock: stock, openingWarehouse: main.id, lowStockLevel: Math.round(stock / 6),
      ...(ctn ? { packUnits: [{ unit: 'CTN', factor: ctn }] } : {}),
    },
  });
  pid[name] = d.id;
}

// ---------------------------------------------------------------- 4. team
console.log('\n4. Team');
const team = [
  ['manager', 'sneha', { name: 'Sneha Kulkarni', phone: '+91 98220 45790', role: 'MANAGER', title: 'Sales Manager', territory: 'Pune City' }],
  ['amit', 'amit', { name: 'Amit Jadhav', phone: '+91 98220 45791', role: 'SALESMAN', salesType: 'PRESALE', title: 'Sales Executive', territory: 'Kothrud & Market Yard' }],
  ['pooja', 'pooja', { name: 'Pooja Shinde', phone: '+91 98220 45792', role: 'SALESMAN', salesType: 'BOTH', title: 'Van Sales Executive', territory: 'Hadapsar & Magarpatta' }],
  ['accountant', 'vikas', { name: 'Vikas Patil', phone: '+91 98220 45793', role: 'ACCOUNTANT', title: 'Accountant' }],
  ['store', 'ganesh', { name: 'Ganesh More', phone: '+91 98220 45794', role: 'WAREHOUSE', title: 'Store Keeper', warehouse: main.id }],
];
const users = await list('/api/v1/users', T);
const uid = {};
const TEAM_START = `${TEAM_PW}#1`;
for (const [key, login, body] of team) {
  const found = users.find((u) => u.email === mail(login));
  uid[key] = found ? found.id : (await must(`user ${body.name} (${body.role})`, 'POST', '/api/v1/users', { ...A, body: { ...body, email: mail(login), password: TEAM_START } })).id;
}
for (const k of ['amit', 'pooja']) await must(`${k} reports to the manager`, 'PATCH', `/api/v1/users/${uid[k]}`, { ...A, body: { reportingManager: uid.manager } });
const tok = {};
for (const [key, login] of team) tok[key] = await signIn(mail(login), TEAM_START, TEAM_PW);
console.log('  ok  team signed in');

// ---------------------------------------------------------------- 5. routes, customers, suppliers
console.log('\n5. Routes, customers & suppliers');
const routes = await list('/api/v1/routes', T);
const rid = {};
for (const r of [
  { name: 'Kothrud - Karve Nagar', code: 'KTH', territory: 'Kothrud', beatDays: ['MON', 'THU'], assignedTo: uid.amit, warehouse: main.id, sequence: 1 },
  { name: 'Market Yard - Swargate', code: 'MKY', territory: 'Market Yard', beatDays: ['WED', 'SAT'], assignedTo: uid.amit, warehouse: main.id, sequence: 2 },
  { name: 'Hadapsar - Magarpatta', code: 'HDP', territory: 'Hadapsar', beatDays: ['TUE', 'FRI'], assignedTo: uid.pooja, warehouse: sub.id, sequence: 3 },
]) {
  rid[r.code] = routes.find((x) => x.code === r.code)?.id || (await must(`route ${r.name}`, 'POST', '/api/v1/routes', { ...A, body: r })).id;
}
const shops = [
  // name, type, contact, phone, address, area, PIN, GSTIN, route, credit limit, terms, salesman
  ['Shree Balaji Kirana Stores', 'RETAIL', 'Sunil Agarwal', '+91 98901 23456', 'Shop 3, Paud Road', 'Kothrud', '411038', '27ABJPA4512K1Z3', 'KTH', 50000, 'NET_15', 'amit'],
  ['Om Sai Super Market', 'RETAIL', 'Rahul Joshi', '+91 98901 34567', '12, Karve Road', 'Karve Nagar', '411052', '27AQZPJ7821L1Z9', 'KTH', 75000, 'NET_15', 'amit'],
  ['Laxmi Provision Stores', 'RETAIL', 'Manoj Gupta', '+91 98222 11223', '45, Shankarsheth Road', 'Swargate', '411042', '', 'MKY', 25000, 'IMMEDIATE', 'amit'],
  ['Patil Wholesale Traders', 'WHOLESALE', 'Sanjay Patil', '+91 97650 44556', 'Shop 118, Market Yard', 'Gultekdi', '411037', '27AAHFP3345Q1ZM', 'MKY', 300000, 'NET_30', 'amit'],
  ['Mahalaxmi General Stores', 'RETAIL', 'Prakash Shah', '+91 99220 77889', 'Near Hadapsar Gadital', 'Hadapsar', '411028', '27BKVPS9087D1Z1', 'HDP', 40000, 'NET_7', 'pooja'],
  ['New Annapurna Mart', 'RETAIL', 'Kavita Deshpande', '+91 98500 66778', 'Destination Centre', 'Magarpatta City', '411013', '27CDFPD2219N1ZT', 'HDP', 60000, 'NET_15', 'pooja'],
  ['Ganraj Distributors', 'DISTRIBUTOR', 'Vijay Kale', '+91 90110 22334', 'Plot J-104, MIDC', 'Bhosari', '411026', '27AAJCG5567R1ZK', 'MKY', 500000, 'NET_45', 'amit'],
  ['Sai Krupa Medical & General', 'RETAIL', 'Nilesh Pawar', '+91 95520 99887', 'Mrutyunjay Society, Paud Road', 'Kothrud', '411038', '27DGLPP6654B1ZQ', 'KTH', 20000, 'IMMEDIATE', 'amit'],
  ['Shiv Shakti Dairy & Kirana', 'RETAIL', 'Ramesh Yadav', '+91 88050 11220', 'Satavwadi', 'Hadapsar', '411028', '', 'HDP', 15000, 'IMMEDIATE', 'pooja'],
  ['Deccan Mega Mart', 'WHOLESALE', 'Arvind Kulkarni', '+91 98230 55443', 'FC Road', 'Deccan Gymkhana', '411004', '27AAACD7712H1Z0', 'MKY', 250000, 'NET_30', 'amit'],
];
const customers = await list('/api/v1/customers', T);
const cid = {};
for (const [name, type, contactPerson, phone, line1, area, pincode, gstin, route, creditLimit, paymentTerms, salesman] of shops) {
  cid[name] = customers.find((x) => x.name === name)?.id || (await must(`customer ${name}`, 'POST', '/api/v1/customers', {
    ...A,
    body: { name, type, contactPerson, phone, gstin, address: { line1, line2: area, city: 'Pune', state: 'Maharashtra', country: 'India', pincode }, route: rid[route], creditLimit, paymentTerms, assignedTo: uid[salesman] },
  })).id;
}
const vendorRows = [
  ['Western India FMCG Distributors Pvt Ltd', 'Harish Mehta', '+91 20 2426 7788', 'Unit 5, Bhosari MIDC', 'Bhosari', 'Pune', '411026', '27AABCW4410M1ZB', 'HDFC Bank', 'HDFC0000146', '50200012345678', 'NET_30', 30],
  ['Sahyadri Dairy Foods Supply', 'Anil Bhosale', '+91 98230 66110', 'Gat No. 112, Chakan', 'Chakan', 'Pune', '410501', '27AAQFS8823K1ZD', 'Bank of Maharashtra', 'MAHB0000271', '60231245789', 'NET_15', 15],
  ['Deccan Edible Oils Agency', 'Mohan Rathi', '+91 97300 45120', '23, Timber Market', 'Bhavani Peth', 'Pune', '411042', '27ADBPR6631F1Z8', 'State Bank of India', 'SBIN0001110', '38912765430', 'NET_15', 15],
  ['Maharashtra Home & Personal Care Pvt Ltd', 'Sachin Gore', '+91 22 2852 3344', 'Plot C-7, TTC Industrial Area', 'Turbhe', 'Navi Mumbai', '400705', '27AACCM9912P1ZX', 'ICICI Bank', 'ICIC0000104', '000405123456', 'NET_45', 45],
];
const suppliers = await list('/api/v1/suppliers', T);
const sid = {};
for (const [name, contactPerson, phone, line1, area, city, pincode, gstin, bankName, ifsc, accountNumber, paymentTerms, creditDays] of vendorRows) {
  sid[name] = suppliers.find((x) => x.name === name)?.id || (await must(`supplier ${name}`, 'POST', '/api/v1/suppliers', {
    ...A,
    body: {
      name, contactPerson, phone, gstin, paymentTerms, creditDays,
      address: { line1, line2: area, city, state: 'Maharashtra', country: 'India', pincode },
      bank: { accountName: name, accountNumber, ifsc, bankName, branch: area },
    },
  })).id;
}

// ---------------------------------------------------------------- 6. pricing
console.log('\n6. Price list, discount & scheme');
const priceLists = await list('/api/v1/price-lists', T);
let wholesale = priceLists.find((x) => x.name === 'Wholesale Rates')?.id;
if (!wholesale) {
  wholesale = (await must('price list Wholesale Rates', 'POST', '/api/v1/price-lists', {
    ...A,
    body: { name: 'Wholesale Rates', type: 'WHOLESALE', validFrom: today, description: 'Dealer prices for wholesale and distributor accounts', items: productRows.map((r) => ({ product: pid[r[0]], price: r[8] })) },
  })).id;
}
for (const n of ['Patil Wholesale Traders', 'Ganraj Distributors', 'Deccan Mega Mart']) {
  await must(`wholesale rates for ${n}`, 'PATCH', `/api/v1/customers/${cid[n]}`, { ...A, body: { priceList: wholesale } });
}
if (!(await list('/api/v1/discounts', T)).some((x) => x.name === 'Wholesale 2% off - Home Care')) {
  await must('discount Wholesale 2% off - Home Care', 'POST', '/api/v1/discounts', {
    ...A,
    body: { name: 'Wholesale 2% off - Home Care', discountPercent: 2, customerScope: 'CUSTOMER_TYPE', customerTypes: ['WHOLESALE', 'DISTRIBUTOR'], productScope: 'CATEGORY', categories: ['Detergents', 'Dishwash'], validFrom: today },
  });
}
if (!(await list('/api/v1/schemes', T)).some((x) => x.name === 'Parle-G 10+1 Free')) {
  await must('scheme Parle-G 10+1 Free', 'POST', '/api/v1/schemes', {
    ...A,
    body: { name: 'Parle-G 10+1 Free', type: 'FREE_GOODS', productScope: 'PRODUCT', products: [pid['Parle-G Biscuits 800g']], buyQty: 10, freeQty: 1, repeat: true, validFrom: today },
  });
}

// ---------------------------------------------------------------- 7. activity (only the first time)
console.log('\n7. Day-to-day activity');
if ((await list('/api/v1/invoices', T)).length) {
  console.log('  skip the company already has invoices');
} else {
  // Purchase: PO -> goods receipt (6 damaged) -> bill -> NEFT part payment -> return
  const vendor = sid['Maharashtra Home & Personal Care Pvt Ltd'];
  const po = await must('purchase order (sent)', 'POST', '/api/v1/purchase-orders', {
    ...A,
    body: { supplierId: vendor, warehouse: main.id, send: true, paymentTerms: 'NET_45', notes: 'Monthly replenishment - home & personal care', items: [
      { product: pid['Surf Excel Easy Wash 1kg'], qty: 120, unitPrice: 122 },
      { product: pid['Vim Dishwash Bar 300g x3'], qty: 144, unitPrice: 78 },
      { product: pid['Colgate Strong Teeth 200g'], qty: 96, unitPrice: 109 },
    ] },
  });
  const grn = await must('goods receipt posted (6 Vim bars damaged)', 'POST', '/api/v1/goods-receipts', {
    ...A,
    body: {
      purchaseOrder: po.id, warehouse: main.id, supplierId: vendor, invoiceNo: 'MHPC/26-27/04128', vehicleNo: 'MH43BG2210', post: true,
      items: po.items.map((i) => {
        const product = String(i.product?.id || i.product?._id || i.product);
        const vim = product === pid['Vim Dishwash Bar 300g x3'];
        return { product, receivedQty: Number(i.qty), unitCost: Number(i.unitPrice), ...(vim ? { rejectedQty: 6, rejectReason: 'Cartons wet / damaged' } : {}) };
      }),
    },
  });
  const grnItems = grn.items || (await call('GET', `/api/v1/goods-receipts/${grn.id}`, A)).body.data.items;
  const bill = await must('supplier bill with Rs 350 freight', 'POST', '/api/v1/purchase-bills', {
    ...A,
    body: { supplierId: vendor, supplierInvoiceNo: 'MHPC/26-27/04128', supplierInvoiceDate: today, grnIds: [grn.id], otherCharges: 350, notes: 'Freight charged on invoice', items: grnItems.map((i) => ({ grnItemId: i.id || i._id, qty: Number(i.acceptedQty) })) },
  });
  await must('NEFT part payment Rs 20,000', 'POST', '/api/v1/supplier-payments', {
    ...A, body: { supplierId: vendor, amount: 20000, mode: 'BANK_TRANSFER', reference: 'NEFT HDFCN52026111300421', paymentDate: today, allocations: [{ bill: bill.id, amount: 20000 }] },
  });
  const vimLine = grnItems.find((i) => String(i.product?.id || i.product?._id || i.product) === pid['Vim Dishwash Bar 300g x3']);
  await must('purchase return 12 Vim bars', 'POST', '/api/v1/purchase-returns', { ...A, body: { grnId: grn.id, reason: 'Wrong batch supplied - expiry within 3 months', items: [{ grnItemId: vimLine.id || vimLine._id, qty: 12 }] } });

  // Sales: order -> invoice -> dispatch -> deliver -> UPI part payment -> credit note
  const o1 = await must('order Shree Balaji Kirana (scheme: 2 Parle-G free)', 'POST', '/api/v1/orders', {
    ...A,
    body: { customerId: cid['Shree Balaji Kirana Stores'], paymentMode: 'CREDIT', submit: true, poReference: 'SBK/PO/0457', notes: 'Deliver before 11 am', items: [
      { product: pid['Amul Butter 500g'], qty: 10 }, { product: pid['Parle-G Biscuits 800g'], qty: 20 },
      { product: pid['Tata Tea Premium 1kg'], qty: 5 }, { product: pid['Surf Excel Easy Wash 1kg'], qty: 12 },
    ] },
  });
  const inv1 = await must('invoice issued', 'POST', '/api/v1/invoices', { ...A, body: { orderId: o1.id, issue: true } });
  await must('order dispatched', 'POST', `/api/v1/orders/${o1.id}/dispatch`, { ...A, body: { note: 'Sent with Tata Ace MH12RK4521' } });
  await must('order delivered', 'POST', `/api/v1/orders/${o1.id}/deliver`, { ...A, body: { note: 'Received by Sunil Agarwal' } });
  await must('UPI receipt Rs 3,000', 'POST', '/api/v1/payments', {
    ...A, body: { customerId: cid['Shree Balaji Kirana Stores'], amount: 3000, mode: 'UPI', reference: 'UPI 431829011245', paymentDate: today, allocations: [{ invoice: inv1.id, amount: 3000 }], receive: true },
  });
  const butter = inv1.items.find((i) => i.name === 'Amul Butter 500g');
  await must('credit note: 2 butter packs damaged', 'POST', '/api/v1/credit-notes', {
    ...A, body: { invoiceId: inv1.id, reason: 'DAMAGE', reasonNote: '2 packs leaking at delivery', items: [{ invoiceItemId: butter.id || butter._id, qty: 2 }], issue: true },
  });

  // Wholesale order above Rs 50,000 -> approval -> invoice -> dispatch -> cheque
  const o2 = await must('order Patil Wholesale (needs approval)', 'POST', '/api/v1/orders', {
    ...A,
    body: { customerId: cid['Patil Wholesale Traders'], paymentMode: 'CREDIT', submit: true, notes: 'Diwali stock - deliver to Market Yard shop', items: [
      { product: pid['Fortune Sunflower Oil 1L'], qty: 10, unit: 'CTN' }, { product: pid['Aashirvaad Whole Wheat Atta 10kg'], qty: 30 },
      { product: pid['India Gate Basmati Rice 5kg'], qty: 20 }, { product: pid['Tata Salt 1kg'], qty: 4, unit: 'CTN' },
      { product: pid['Vim Dishwash Bar 300g x3'], qty: 2, unit: 'CTN' },
    ] },
  });
  if (o2.status === 'PENDING_APPROVAL') await must('manager approves', 'POST', `/api/v1/orders/${o2.id}/approve`, { token: tok.manager, body: { note: 'Approved - regular wholesale buyer' } });
  const inv2 = await must('invoice Patil order', 'POST', '/api/v1/invoices', { ...A, body: { orderId: o2.id, issue: true } });
  await must('dispatch Patil order', 'POST', `/api/v1/orders/${o2.id}/dispatch`, { ...A, body: { note: 'Tata 407 - MH12 KQ 7781' } });
  await must('deliver Patil order', 'POST', `/api/v1/orders/${o2.id}/deliver`, { ...A, body: { note: 'Unloaded at shop 118' } });
  await must('cheque Rs 25,000', 'POST', '/api/v1/payments', {
    ...A, body: { customerId: cid['Patil Wholesale Traders'], amount: 25000, mode: 'CHEQUE', reference: '004512', bankName: 'Cosmos Bank', chequeDate: today, paymentDate: today, allocations: [{ invoice: inv2.id, amount: 25000 }], receive: true },
  });

  // Load the van; Pooja's day: attendance, shop visit, van sale with cash
  const tr = await must('load van: Parle-G, Maggi, Tata Salt', 'POST', '/api/v1/inventory/transfers', {
    ...A, body: { fromWarehouse: main.id, toWarehouse: van.id, vehicleNo: 'MH12RK4521', notes: 'Hadapsar beat', items: [{ product: pid['Parle-G Biscuits 800g'], qty: 48 }, { product: pid['Maggi 2-Minute Noodles 12-pack'], qty: 24 }, { product: pid['Tata Salt 1kg'], qty: 24 }] },
  });
  await must('dispatch van load', 'POST', `/api/v1/inventory/transfers/${tr.id}/dispatch`, { ...A, body: {} });
  await must('receive van load', 'POST', `/api/v1/inventory/transfers/${tr.id}/receive`, { ...A, body: {} });
  const POOJA = { token: tok.pooja };
  await call('POST', '/api/v1/field-force/attendance/check-in', { ...POOJA, body: { location: { lat: 18.5089, lng: 73.926 }, accuracy: 10, address: 'Hadapsar, Pune', source: 'MOBILE' } });
  const v1 = await must('Pooja plans a visit', 'POST', '/api/v1/field-force/visits', { ...POOJA, body: { customerId: cid['Mahalaxmi General Stores'], purpose: 'ORDER', source: 'MOBILE' } });
  await must('Pooja checks in at Mahalaxmi General Stores', 'POST', `/api/v1/field-force/visits/${v1.id}/check-in`, { ...POOJA, body: { location: { lat: 18.5018, lng: 73.9339 }, accuracy: 12, address: 'Near Hadapsar Gadital', source: 'MOBILE' } });
  const vanSale = await must('van sale invoice', 'POST', '/api/v1/invoices', {
    ...POOJA, body: { customerId: cid['Mahalaxmi General Stores'], warehouse: van.id, paymentMode: 'CASH', issue: true, items: [{ product: pid['Parle-G Biscuits 800g'], qty: 12 }, { product: pid['Maggi 2-Minute Noodles 12-pack'], qty: 6 }, { product: pid['Tata Salt 1kg'], qty: 10 }] },
  });
  await must('cash collected', 'POST', '/api/v1/payments', { ...POOJA, body: { customerId: cid['Mahalaxmi General Stores'], amount: Number(vanSale.total), mode: 'CASH', paymentDate: today, allocations: [{ invoice: vanSale.id, amount: Number(vanSale.total) }], receive: true } });
  await must('Pooja checks out', 'POST', `/api/v1/field-force/visits/${v1.id}/check-out`, { ...POOJA, body: { location: { lat: 18.5018, lng: 73.9339 }, outcome: 'ORDER_TAKEN', notes: 'Asked for Diwali gift packs next week' } });

  // Amit's day: attendance, visit, order booked at the shop
  const AMIT = { token: tok.amit };
  await call('POST', '/api/v1/field-force/attendance/check-in', { ...AMIT, body: { location: { lat: 18.4893, lng: 73.8213 }, accuracy: 12, address: 'Karve Nagar, Pune', source: 'MOBILE' } });
  const v2 = await must('Amit plans a visit', 'POST', '/api/v1/field-force/visits', { ...AMIT, body: { customerId: cid['Om Sai Super Market'], purpose: 'ORDER', source: 'MOBILE' } });
  await must('Amit checks in at Om Sai Super Market', 'POST', `/api/v1/field-force/visits/${v2.id}/check-in`, { ...AMIT, body: { location: { lat: 18.4895, lng: 73.821 }, accuracy: 15, address: '12, Karve Road', source: 'MOBILE' } });
  await must('Amit books an order', 'POST', '/api/v1/orders', {
    ...AMIT, body: { customerId: cid['Om Sai Super Market'], paymentMode: 'CREDIT', submit: true, notes: 'Weekly refill', items: [
      { product: pid['Amul Taaza Toned Milk 1L'], qty: 24 }, { product: pid['Britannia Good Day Cashew 600g'], qty: 12 },
      { product: pid['Colgate Strong Teeth 200g'], qty: 12 }, { product: pid['Dettol Original Soap 125g x4'], qty: 6 },
    ] },
  });
  await must('Amit checks out', 'POST', `/api/v1/field-force/visits/${v2.id}/check-out`, { ...AMIT, body: { location: { lat: 18.4895, lng: 73.821 }, outcome: 'ORDER_TAKEN', notes: 'Order booked' } });

  // Open work for the demo: an order to dispatch and a PO awaiting delivery
  await must('order Deccan Mega Mart (to dispatch)', 'POST', '/api/v1/orders', {
    ...A, body: { customerId: cid['Deccan Mega Mart'], paymentMode: 'CREDIT', submit: true, items: [{ product: pid['Nescafe Classic Coffee 200g'], qty: 1, unit: 'CTN' }, { product: pid['Clinic Plus Shampoo 650ml'], qty: 2, unit: 'CTN' }, { product: pid['Surf Excel Easy Wash 1kg'], qty: 2, unit: 'CTN' }] },
  });
  await must('PO to Sahyadri Dairy (awaiting delivery)', 'POST', '/api/v1/purchase-orders', {
    ...A, body: { supplierId: sid['Sahyadri Dairy Foods Supply'], warehouse: main.id, send: true, paymentTerms: 'NET_15', items: [{ product: pid['Amul Butter 500g'], qty: 60 }, { product: pid['Amul Taaza Toned Milk 1L'], qty: 240 }] },
  });
  await must('write off 3 burst milk packs', 'POST', '/api/v1/inventory/adjustments', { ...A, body: { warehouse: main.id, reason: 'DAMAGE', notes: 'Packets burst in cold storage', post: true, items: [{ product: pid['Amul Taaza Toned Milk 1L'], qty: -3 }] } });
}

console.log(`\nDone. Sign in at the app with company code ${CODE}:`);
console.log(`  admin       ${mail('rohan')}   (DEMO_ADMIN_PASSWORD)`);
for (const [, login, body] of team) console.log(`  ${body.role.toLowerCase().padEnd(11)} ${mail(login)}   (DEMO_TEAM_PASSWORD)`);
console.log(`(${calls} API calls)`);
