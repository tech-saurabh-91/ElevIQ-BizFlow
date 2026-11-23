/**
 * Sample rows for the bulk-import templates.
 *
 * Every template gets a "Sample" sheet: the same columns as the sheet that is
 * imported, filled with a few realistic rows, so people see exactly what goes
 * where. The importer only reads the main sheet, so the samples are never
 * imported - and a sample row copied into the main sheet by mistake is caught
 * by `isSampleRow`.
 */

const BANNER = 'FF9A3412';
const SAMPLE_FILL = 'FFFFF7ED';

/**
 * Add a sample sheet after the main one.
 * @param {import('exceljs').Workbook} wb
 * @param {{ columns: {key,header,required?,width?}[], rows: object[], target: string, notes?: string[] }} opts
 */
export const addSampleSheet = (wb, { columns, rows, target, notes = [] }) => {
  const sheet = wb.addWorksheet('Sample', {
    properties: { tabColor: { argb: 'FFF97316' } },
    views: [{ state: 'frozen', ySplit: 2 }],
  });
  sheet.columns = columns.map((c) => ({ key: c.key, width: c.width || 16 }));

  // Row 1: what this sheet is.
  sheet.mergeCells(1, 1, 1, Math.min(columns.length, 8));
  const banner = sheet.getCell(1, 1);
  banner.value = `SAMPLE ONLY - not imported. Fill your own rows on the "${target}" sheet, in the same columns.${notes.length ? ` ${notes.join(' ')}` : ''}`;
  banner.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  banner.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BANNER } };
  banner.alignment = { vertical: 'middle', wrapText: true };
  sheet.getRow(1).height = 34;

  // Row 2: the same headers as the main sheet.
  const head = sheet.getRow(2);
  columns.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.required ? `${c.header} *` : c.header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: c.required ? 'FF1D4ED8' : 'FF475569' },
    };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  head.height = 30;

  // Number columns hold numbers; everything else is text (phones, PIN codes and barcodes keep their digits).
  const numeric = (c) => c.type === 'number' || c.type === 'int';
  rows.forEach((r) => {
    const values = columns.map((c) => {
      const v = r[c.key];
      if (v === undefined || v === null || v === '') return '';
      return numeric(c) && Number.isFinite(Number(v)) ? Number(v) : String(v);
    });
    const row = sheet.addRow(values);
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: SAMPLE_FILL } };
      if (!numeric(c)) cell.numFmt = '@';
    });
  });
  return sheet;
};

const norm = (v) =>
  String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** True when `values` (key -> text) repeats a sample row on all of `keys`. */
export const isSampleRow = (values, samples, keys) =>
  samples.some((s) => keys.every((k) => norm(s[k]) && norm(s[k]) === norm(values[k])));

export const sampleRowError =
  'This is a sample row from the template. Delete it and enter your own data.';

// ---------------------------------------------------------------------------
// The samples: a distributor in Pune selling FMCG goods.
// ---------------------------------------------------------------------------

export const CUSTOMER_SAMPLES = [
  {
    name: 'Shree Balaji Kirana Stores',
    type: 'Retail',
    contactPerson: 'Ramesh Agarwal',
    phone: '+91 98220 11004',
    email: 'balajikirana.kharadi@gmail.com',
    gstin: '27AAPFB1234C1Z5',
    pan: 'AAPFB1234C',
    'address.line1': 'Shop 4, Kharadi Main Road',
    'address.line2': 'Near EON IT Park',
    'address.country': 'India',
    'address.state': 'Maharashtra',
    'address.city': 'Pune',
    'address.pincode': '411014',
    shippingSameAsBilling: 'Yes',
    paymentTerms: 'Net 15',
    creditLimit: '50000',
    openingBalance: '12500',
    tags: 'kirana, east pune',
    notes: 'Delivery before 11 am',
    isActive: 'Yes',
  },
  {
    name: 'Metro Wholesale Traders',
    type: 'Wholesale',
    contactPerson: 'Sunil Mehta',
    phone: '+91 98200 22005',
    alternatePhone: '+91 20 2612 3456',
    email: 'accounts@metrowholesale.in',
    gstin: '27AAKCM5678D1Z2',
    pan: 'AAKCM5678D',
    'address.line1': 'Gala 12, Market Yard',
    'address.line2': 'Gultekdi',
    'address.country': 'India',
    'address.state': 'Maharashtra',
    'address.city': 'Pune',
    'address.pincode': '411037',
    shippingSameAsBilling: 'No',
    'shippingAddress.line1': 'Godown 3, Mumbai-Nashik Highway',
    'shippingAddress.line2': 'Bhiwandi',
    'shippingAddress.country': 'India',
    'shippingAddress.state': 'Maharashtra',
    'shippingAddress.city': 'Thane',
    'shippingAddress.pincode': '421302',
    paymentTerms: 'Net 30',
    creditLimit: '300000',
    openingBalance: '0',
    tags: 'wholesale, key account',
    isActive: 'Yes',
  },
  {
    name: 'Krishna Distributors',
    type: 'Distributor',
    contactPerson: 'Venkat Rao',
    phone: '+91 99890 33006',
    email: 'krishnadist.hyd@gmail.com',
    gstin: '36AAEFK9012E1Z8',
    pan: 'AAEFK9012E',
    'address.line1': '8-2-120, Begum Bazar',
    'address.country': 'India',
    'address.state': 'Telangana',
    'address.city': 'Hyderabad',
    'address.pincode': '500012',
    shippingSameAsBilling: 'Yes',
    paymentTerms: 'Custom',
    creditDays: '45',
    creditLimit: '500000',
    openingBalance: '84000',
    tags: 'out of state',
    notes: 'Inter-state: IGST applies',
    isActive: 'Yes',
  },
];

export const CUSTOMER_SAMPLE_NOTES = [
  'Price list, salesman email and warehouse code must be ones that exist in your company (pick them from the drop-down).',
];

export const PRODUCT_SAMPLES = [
  {
    name: 'Parle-G Gold Biscuit 100g',
    customCode: 'PG-100',
    barcode: '8901719101038',
    classification: 'Food',
    category: 'Biscuits',
    subCategory: 'Glucose biscuits',
    brand: 'Parle',
    unit: 'PCS',
    'pack0.unit': 'BOX',
    'pack0.factor': '48',
    'pack0.price': '420',
    hsnCode: '1905',
    gstRate: '18',
    mrp: '10',
    sellingPrice: '9',
    dealerPrice: '8.75',
    purchasePrice: '8.2',
    openingStock: '960',
    lowStockLevel: '192',
    description: 'Glucose biscuit, 100 g pack',
    tags: 'fast moving',
    isActive: 'Yes',
  },
  {
    name: 'Tata Salt 1kg',
    customCode: 'TS-1KG',
    barcode: '8904043901015',
    classification: 'Food',
    category: 'Staples',
    subCategory: 'Salt',
    brand: 'Tata',
    unit: 'PCS',
    'pack0.unit': 'BAG',
    'pack0.factor': '25',
    hsnCode: '2501',
    gstRate: '0',
    mrp: '28',
    sellingPrice: '26',
    dealerPrice: '25',
    purchasePrice: '23.5',
    openingStock: '500',
    lowStockLevel: '100',
    tags: 'staples',
    isActive: 'Yes',
  },
  {
    name: 'Surf Excel Easy Wash 1kg',
    customCode: 'SE-1KG',
    barcode: '8901030704871',
    classification: 'Home Care',
    category: 'Detergents',
    subCategory: 'Detergent powder',
    brand: 'Surf Excel',
    unit: 'PCS',
    'pack0.unit': 'CTN',
    'pack0.factor': '12',
    'pack0.price': '1500',
    hsnCode: '3402',
    gstRate: '18',
    mrp: '140',
    sellingPrice: '128',
    dealerPrice: '124',
    purchasePrice: '115',
    openingStock: '120',
    lowStockLevel: '24',
    isActive: 'Yes',
  },
];

export const PRODUCT_SAMPLE_NOTES = [
  'Classification, category, sub-category and units must already exist in Categories & Units - use your own names.',
];

/** Opening stock: what a filled row looks like (codes are the product codes of your company). */
export const OPENING_STOCK_SAMPLES = [
  { code: 'PRD-00001', name: 'Parle-G Gold Biscuit 100g', unit: 'PCS', qty: '960', cost: '8.20' },
  { code: 'PRD-00002', name: 'Tata Salt 1kg', unit: 'PCS', qty: '500', cost: '23.50' },
  { code: 'PRD-00003', name: 'Surf Excel Easy Wash 1kg', unit: 'PCS', qty: '120', cost: '' },
];

export default {
  addSampleSheet,
  isSampleRow,
  sampleRowError,
  CUSTOMER_SAMPLES,
  PRODUCT_SAMPLES,
  OPENING_STOCK_SAMPLES,
};
