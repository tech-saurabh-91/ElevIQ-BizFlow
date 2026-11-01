import { runWithContext } from '../middlewares/tenantContext.js';
import logger from '../utils/logger.js';
import Warehouse from '../models/Warehouse.js';
import Route from '../models/Route.js';
import Product from '../models/Product.js';
import Customer from '../models/Customer.js';
import Supplier from '../models/Supplier.js';
import PriceList from '../models/PriceList.js';
import Setting from '../models/Setting.js';
import AuditLog from '../models/AuditLog.js';

/**
 * Phase 3 demo master data: warehouses, beats, products, customers, suppliers
 * and price lists. Safe to re-run: every block is skipped when data exists.
 */

const inTenant = (company, fn) =>
  runWithContext(
    { scope: 'company', companyId: String(company._id), userId: null },
    fn
  );

const seedWarehouses = (company, users) => {
  const storeKeeper = users.find((u) => u.role === 'WAREHOUSE') || null;

  return [
    {
      name: 'Main Warehouse',
      code: 'WH-MAIN',
      type: 'MAIN',
      phone: '+912012345678',
      email: 'warehouse@demotraders.com',
      manager: storeKeeper?._id || null,
      isDefault: true,
      capacity: 12000,
      address: { line1: 'Plot 14, MIDC Industrial Area', city: 'Pune', state: 'Maharashtra', pincode: '411019' },
      notes: 'Primary dispatch location for all routes.',
    },
    {
      name: 'Pune City Branch',
      code: 'WH-PUNE',
      type: 'BRANCH',
      phone: '+912023456789',
      email: 'pune.branch@demotraders.com',
      capacity: 4500,
      address: { line1: '22 Laxmi Road', city: 'Pune', state: 'Maharashtra', pincode: '411002' },
      notes: 'City counter sales and urgent deliveries.',
    },
    {
      name: 'PCMC Transit Depot',
      code: 'WH-PCMC',
      type: 'TRANSIT',
      capacity: 1800,
      address: { line1: 'Sector 19, Bhosari', city: 'Pimpri-Chinchwad', state: 'Maharashtra', pincode: '411039' },
      notes: 'Cross-dock for PCMC beat vans.',
    },
  ];
};

const seedRoutes = (warehouses, users) => {
  const amit = users.find((u) => u.email === 'amit@demotraders.com') || null;
  const sneha = users.find((u) => u.email === 'sneha@demotraders.com') || null;
  const main = warehouses.find((w) => w.code === 'WH-MAIN') || warehouses[0];

  return [
    {
      name: 'Pune East Beat',
      code: 'RTE-EAST',
      territory: 'Pune East',
      warehouse: main?._id || null,
      assignedTo: amit?._id || null,
      beatDays: ['MON', 'THU'],
      sequence: 1,
      description: 'Kharadi, Viman Nagar, Wagholi and Hadapsar retail outlets.',
    },
    {
      name: 'Pune West Beat',
      code: 'RTE-WEST',
      territory: 'Pune West',
      warehouse: main?._id || null,
      assignedTo: sneha?._id || null,
      beatDays: ['TUE', 'FRI'],
      sequence: 2,
      description: 'Baner, Aundh, Kothrud and Warje outlets.',
    },
    {
      name: 'PCMC Beat',
      code: 'RTE-PCMC',
      territory: 'PCMC',
      warehouse: main?._id || null,
      assignedTo: amit?._id || null,
      beatDays: ['WED', 'SAT'],
      sequence: 3,
      description: 'Bhosari, Chinchwad and Nigdi distributor network.',
    },
  ];
};

const PRODUCTS = [
  ['Tata Salt 1kg', 'Staples', 'Tata', 'PCS', 28, 24, 22, 18, 5, 120, 40],
  ['Aashirvaad Atta 5kg', 'Staples', 'ITC', 'BAG', 285, 262, 248, 235, 5, 65, 20],
  ['Fortune Sunflower Oil 1L', 'Cooking Oil', 'Adani Wilmar', 'BTL', 165, 152, 144, 138, 5, 90, 25],
  ['Saffola Gold Oil 5L', 'Cooking Oil', 'Marico', 'CAN', 890, 855, 820, 790, 5, 24, 8],
  ['Amul Butter 500g', 'Dairy', 'Amul', 'PCS', 285, 272, 262, 255, 12, 48, 15],
  ['Amul Taaza Milk 1L', 'Dairy', 'Amul', 'PKT', 74, 70, 68, 66, 5, 150, 60],
  ['Colgate Strong Teeth 200g', 'Personal Care', 'Colgate', 'PCS', 115, 104, 99, 92, 18, 85, 30],
  ['Dettol Original Soap 125g', 'Personal Care', 'Dettol', 'PCS', 65, 58, 54, 49, 18, 12, 25],
  ['Surf Excel Easy Wash 1kg', 'Home Care', 'HUL', 'PKT', 148, 136, 130, 122, 18, 70, 25],
  ['Vim Dishwash Bar 300g', 'Home Care', 'HUL', 'PCS', 45, 41, 39, 35, 18, 95, 35],
  ['Parle-G Biscuit 250g', 'Snacks', 'Parle', 'PKT', 30, 27, 25, 23, 18, 180, 60],
  ['Maggi Noodles 12-pack', 'Snacks', 'Nestle', 'BOX', 168, 158, 150, 144, 18, 42, 15],
  ['Haldiram Bhujia 400g', 'Snacks', 'Haldiram', 'PKT', 120, 112, 106, 99, 12, 18, 20],
  ['Bisleri Water 1L', 'Beverages', 'Bisleri', 'BTL', 20, 18, 17, 15, 18, 240, 80],
];

const seedProducts = () =>
  PRODUCTS.map(([name, category, brand, unit, mrp, sellingPrice, dealerPrice, purchasePrice, gstRate, stock, lowStockLevel], idx) => ({
    name,
    sku: `PRD-${String(idx + 1).padStart(5, '0')}`,
    barcode: `89012345${String(idx + 1).padStart(5, '0')}`,
    category,
    brand,
    unit,
    hsnCode: gstRate === 5 ? '1006' : gstRate === 12 ? '0405' : '3401',
    gstRate,
    mrp,
    sellingPrice,
    dealerPrice,
    purchasePrice,
    openingStock: stock,
    stock,
    lowStockLevel,
    isReturnable: true,
    isActive: true,
    description: `${brand} ${name} - fast moving counter item.`,
  }));

const seedSuppliers = () => [
  {
    code: 'SUP-00001',
    name: 'Unilever India Ltd',
    contactPerson: 'Mahesh Kulkarni',
    phone: '+912022001122',
    email: 'sales@unilever.test',
    gstin: '27AAACU1234A1Z5',
    paymentTerms: 'NET_30',
    creditDays: 30,
    openingBalance: 0,
    outstanding: 84500,
    categories: ['Home Care', 'Personal Care'],
    address: { line1: 'Andheri East', city: 'Mumbai', state: 'Maharashtra', pincode: '400069' },
  },
  {
    code: 'SUP-00002',
    name: 'Tata Consumer Products',
    contactPerson: 'Rina Desai',
    phone: '+912266778899',
    email: 'trade@tataconsumer.test',
    gstin: '27AAACT5678B1Z2',
    paymentTerms: 'NET_15',
    creditDays: 15,
    openingBalance: 0,
    outstanding: 46200,
    categories: ['Staples', 'Beverages'],
    address: { line1: 'Bandra Kurla Complex', city: 'Mumbai', state: 'Maharashtra', pincode: '400051' },
  },
  {
    code: 'SUP-00003',
    name: 'Pune Agro Wholesale',
    contactPerson: 'Sandeep Jadhav',
    phone: '+919822334455',
    email: 'orders@puneagro.test',
    gstin: '27AABCP9012C1Z8',
    paymentTerms: 'IMMEDIATE',
    creditDays: 0,
    openingBalance: 0,
    outstanding: 18750,
    categories: ['Staples', 'Cooking Oil'],
    address: { line1: 'Market Yard, Gultekdi', city: 'Pune', state: 'Maharashtra', pincode: '411037' },
  },
];

const CUSTOMERS = [
  ['Sharma General Store', 'RETAIL', 'Rajesh Sharma', '+919820011001', 'Pune East', 50000, 'NET_15', 18250, 'MG Road, Camp'],
  ['Patel Super Market', 'WHOLESALE', 'Nilesh Patel', '+919820011002', 'Pune West', 150000, 'NET_30', 62400, 'FC Road, Shivajinagar'],
  ['Krishna Distributors', 'DISTRIBUTOR', 'Suresh Kulkarni', '+919820011003', 'PCMC', 300000, 'NET_45', 118500, 'Bhosari Industrial Estate'],
  ['Balaji Kirana Stores', 'RETAIL', 'Anil Joshi', '+919820011004', 'Pune East', 40000, 'NET_7', 9200, 'Kharadi Main Road'],
  ['Metro Cash & Carry', 'WHOLESALE', 'Farhan Shaikh', '+919820011005', 'Pune West', 250000, 'NET_30', 87400, 'Baner Road'],
  ['New Age Traders', 'DEALER', 'Pooja Mehta', '+919820011006', 'PCMC', 200000, 'NET_30', 43600, 'Chinchwad Station Road'],
  ['Ganesh Provision Store', 'RETAIL', 'Ganesh Pawar', '+919820011007', 'Pune East', 30000, 'IMMEDIATE', 0, 'Wagholi'],
];

const seedCustomers = (routes, warehouses, priceLists, users) => {
  const retail = priceLists.find((p) => p.type === 'RETAIL') || priceLists[0];
  const wholesale = priceLists.find((p) => p.type === 'WHOLESALE') || priceLists[0];
  const amit = users.find((u) => u.email === 'amit@demotraders.com') || null;
  const sneha = users.find((u) => u.email === 'sneha@demotraders.com') || null;
  const main = warehouses[0];

  return CUSTOMERS.map(
    ([name, type, contactPerson, phone, territory, creditLimit, paymentTerms, outstanding, line1], idx) => {
      const route =
        routes.find((r) => r.territory === territory) || routes[idx % routes.length] || null;
      return {
        code: `CUS-${String(idx + 1).padStart(5, '0')}`,
        name,
        type,
        contactPerson,
        phone,
        email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.test`,
        gstin: `27AAAC${String(1000 + idx)}D1Z${idx % 9}`,
        territory,
        creditLimit,
        creditDays: paymentTerms === 'IMMEDIATE' ? 0 : Number(String(paymentTerms).replace('NET_', '')),
        paymentTerms,
        openingBalance: outstanding,
        outstanding,
        route: route?._id || null,
        assignedTo: route?.assignedTo || (idx % 2 ? sneha?._id : amit?._id) || null,
        warehouse: main?._id || null,
        priceList: type === 'RETAIL' ? retail?._id : wholesale?._id || null,
        address: { line1, city: 'Pune', state: 'Maharashtra', pincode: '411001' },
        tags: idx % 2 ? ['priority'] : [],
        isActive: true,
      };
    }
  );
};

const seedPriceLists = (products) => {
  const base = products.map((p) => ({
    product: p._id,
    price: p.sellingPrice,
    discountPercent: 0,
    minQty: 1,
  }));
  const wholesale = products.map((p) => ({
    product: p._id,
    price: p.dealerPrice,
    discountPercent: 0,
    minQty: 5,
  }));

  return [
    {
      code: 'PL-0001',
      name: 'Retail Price List',
      type: 'RETAIL',
      description: 'Default counter pricing for retail outlets.',
      isDefault: true,
      isActive: true,
      items: base,
    },
    {
      code: 'PL-0002',
      name: 'Wholesale Price List',
      type: 'WHOLESALE',
      description: 'Dealer pricing with a 5-unit minimum order.',
      isDefault: false,
      isActive: true,
      items: wholesale,
    },
    {
      code: 'PL-0003',
      name: 'Distributor Price List',
      type: 'DISTRIBUTOR',
      description: 'Volume pricing for distributors.',
      isDefault: false,
      isActive: true,
      items: products.map((p) => ({
        product: p._id,
        price: Math.round(p.dealerPrice * 0.97 * 100) / 100,
        discountPercent: 0,
        minQty: 20,
      })),
    },
  ];
};

const seedAuditTrail = async (company, admin) => {
  const existing = await inTenant(company, () => AuditLog.countDocuments({}));
  if (existing > 0 || !admin) return;

  const actor = {
    userId: admin._id,
    name: admin.name,
    role: admin.role,
    email: admin.email,
  };
  const base = { companyId: company._id, actor, channel: 'WEB', severity: 'INFO', occurredAt: new Date() };

  await inTenant(company, () => AuditLog.create([
    {
      ...base,
      action: 'CREATE',
      entityType: 'Warehouse',
      entityLabel: 'Main Warehouse',
      description: 'Main warehouse configured for dispatch',
    },
    {
      ...base,
      action: 'CREATE',
      entityType: 'Customer',
      entityLabel: 'Krishna Distributors',
      description: 'Distributor onboarded with NET_45 credit terms',
    },
    {
      ...base,
      action: 'UPDATE',
      entityType: 'Product',
      entityLabel: 'Saffola Gold Oil 5L',
      description: 'Wholesale price revised for the new quarter',
    },
  ]));
};

const run = async (company, users = []) => {
  const existingWarehouses = await inTenant(company, () => Warehouse.countDocuments({}));
  let warehouses;
  if (existingWarehouses === 0) {
    warehouses = await inTenant(company, () => Warehouse.insertMany(seedWarehouses(company, users)));
    logger.info(`Seeded ${warehouses.length} warehouses.`);
  } else {
    warehouses = await inTenant(company, () => Warehouse.find({}).sort({ createdAt: 1 }).lean());
  }

  const existingRoutes = await inTenant(company, () => Route.countDocuments({}));
  let routes;
  if (existingRoutes === 0) {
    routes = await inTenant(company, () => Route.insertMany(seedRoutes(warehouses, users)));
    logger.info(`Seeded ${routes.length} routes/beats.`);
  } else {
    routes = await inTenant(company, () => Route.find({}).lean());
  }

  const existingProducts = await inTenant(company, () => Product.countDocuments({}));
  let products;
  if (existingProducts === 0) {
    products = await inTenant(company, () => Product.insertMany(seedProducts()));
    logger.info(`Seeded ${products.length} products.`);
  } else {
    products = await inTenant(company, () => Product.find({}).lean());
  }

  const existingSuppliers = await inTenant(company, () => Supplier.countDocuments({}));
  if (existingSuppliers === 0) {
    await inTenant(company, () => Supplier.insertMany(seedSuppliers()));
    logger.info('Seeded 3 suppliers.');
  }

  const existingLists = await inTenant(company, () => PriceList.countDocuments({}));
  let priceLists;
  if (existingLists === 0) {
    priceLists = await inTenant(company, () => PriceList.insertMany(seedPriceLists(products)));
    logger.info(`Seeded ${priceLists.length} price lists.`);
  } else {
    priceLists = await inTenant(company, () => PriceList.find({}).lean());
  }

  const existingCustomers = await inTenant(company, () => Customer.countDocuments({}));
  if (existingCustomers === 0) {
    const customers = await inTenant(company, () =>
      Customer.insertMany(seedCustomers(routes, warehouses, priceLists, users))
    );
    logger.info(`Seeded ${customers.length} customers.`);
  }

  const admin = users.find((u) => u.role === 'COMPANY_ADMIN') || null;
  await seedAuditTrail(company, admin);

  await inTenant(company, async () => {
    const main = warehouses.find((w) => w.isDefault) || warehouses[0];
    await Setting.updateOne(
      {},
      {
        $set: {
          'setupProgress.profile': true,
          'setupProgress.users': users.length > 0,
          'setupProgress.customers': true,
          'setupProgress.products': true,
          'setupProgress.warehouse': Boolean(main),
          ...(main ? { 'inventory.defaultWarehouse': main._id } : {}),
        },
      }
    );
  });

  logger.info('Master data ready (Phase 3).');
};

export default run;
