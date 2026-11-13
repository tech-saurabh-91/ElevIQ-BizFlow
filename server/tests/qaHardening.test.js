/**
 * Regression tests for the validation / security gaps found in the full QA pass:
 * request rules that must hold even when the browser form is bypassed.
 */
import { createPlanSchema, createAnnouncementSchema, createCompanySchema } from '../src/validators/platformValidators.js';
import { settingsUpdateSchema, warehouseCreateSchema } from '../src/validators/companyValidators.js';
import { changePasswordSchema } from '../src/validators/authValidators.js';
import { paymentCreateSchema } from '../src/validators/paymentValidators.js';
import { grnLineSchema, transferCreateSchema, adjustmentCreateSchema } from '../src/validators/inventoryValidators.js';
import { resolveLinePricing } from '../src/services/orderService.js';
import { isWebsite, panFromGstin } from '../src/services/identityRules.js';

const id = '6af6885cd761ee6e15b61161';
const ok = (schema, value) => schema.safeParse(value).success;
const future = '2099-01-01';

describe('QA hardening - platform', () => {
  test('plan codes are letters, digits, - or _', () => {
    expect(ok(createPlanSchema, { code: 'GROWTH_2', name: 'Growth', price: 10 })).toBe(true);
    expect(ok(createPlanSchema, { code: 'A B!', name: 'Bad', price: 10 })).toBe(false);
  });

  test('announcement links are https or an in-app path, and end after start', () => {
    expect(ok(createAnnouncementSchema, { title: 'Hello', ctaLink: '/app/reports' })).toBe(true);
    expect(ok(createAnnouncementSchema, { title: 'Hello', ctaLink: 'https://eleviq.in/news' })).toBe(true);
    expect(ok(createAnnouncementSchema, { title: 'Hello', ctaLink: 'javascript:alert(1)' })).toBe(false);
    expect(ok(createAnnouncementSchema, { title: 'Hello', ctaLink: '//evil.example.com' })).toBe(false);
    expect(ok(createAnnouncementSchema, { title: 'Hello', startsAt: '2026-12-10', endsAt: '2026-12-01' })).toBe(false);
  });

  test('a custom billing window cannot end before it starts', () => {
    const base = { businessName: 'Acme', admin: { name: 'Ad Min', email: 'a@acme.test', password: 'Acme#Pass123' } };
    expect(ok(createCompanySchema, { ...base, startMode: 'CUSTOM', startDate: '2027-01-10', endDate: '2027-01-01' })).toBe(false);
    expect(ok(createCompanySchema, { ...base, startMode: 'CUSTOM', startDate: '2027-01-01', endDate: '2027-12-31' })).toBe(true);
  });
});

describe('QA hardening - identity rules', () => {
  test('websites: http(s) or a bare domain, never javascript:', () => {
    expect(isWebsite('https://shreeganeshtraders.in')).toBe(true);
    expect(isWebsite('shreeganeshtraders.in/about')).toBe(true);
    expect(isWebsite('notaurl')).toBe(false);
    expect(isWebsite('javascript:alert(1)')).toBe(false);
  });

  test('the PAN is taken from a valid GSTIN when blank', () => {
    expect(panFromGstin('27AAKCS4821M1ZQ', '')).toBe('AAKCS4821M');
    expect(panFromGstin('bad', '')).toBe('');
    expect(panFromGstin('27AAKCS4821M1ZQ', 'abcde1234f')).toBe('ABCDE1234F');
  });
});

describe('QA hardening - company settings & masters', () => {
  test('UPI ID and working hours are checked', () => {
    expect(ok(settingsUpdateSchema, { invoice: { upiVpa: 'abc' } })).toBe(false);
    expect(ok(settingsUpdateSchema, { invoice: { upiVpa: 'shree.ganesh@hdfcbank' } })).toBe(true);
    expect(ok(settingsUpdateSchema, { fieldForce: { workStart: '99:99' } })).toBe(false);
    expect(ok(settingsUpdateSchema, { fieldForce: { workStart: '18:00', workEnd: '09:00' } })).toBe(false);
    expect(ok(settingsUpdateSchema, { fieldForce: { workStart: '09:30', workEnd: '19:00' } })).toBe(true);
  });

  test('warehouse phone must be a phone number', () => {
    expect(ok(warehouseCreateSchema, { name: 'Main', code: 'MAIN', phone: 'abcdefg' })).toBe(false);
    expect(ok(warehouseCreateSchema, { name: 'Main', code: 'MAIN', phone: '+91 98220 45785' })).toBe(true);
  });
});

describe('QA hardening - transactions', () => {
  test('a new password must differ from the current one', () => {
    expect(ok(changePasswordSchema, { currentPassword: 'Same#Pass123', newPassword: 'Same#Pass123' })).toBe(false);
    expect(ok(changePasswordSchema, { currentPassword: 'Old#Pass123', newPassword: 'New#Pass123' })).toBe(true);
  });

  test('a cheque receipt needs the cheque number', () => {
    expect(ok(paymentCreateSchema, { customerId: id, amount: 100, mode: 'CHEQUE' })).toBe(false);
    expect(ok(paymentCreateSchema, { customerId: id, amount: 100, mode: 'CHEQUE', reference: '004512' })).toBe(true);
  });

  test('stock documents cannot be dated in the future; rejected <= received', () => {
    expect(ok(transferCreateSchema, { fromWarehouse: id, toWarehouse: '6af6885cd761ee6e15b61162', transferDate: future, items: [{ product: id, qty: 1 }] })).toBe(false);
    expect(ok(adjustmentCreateSchema, { warehouse: id, reason: 'DAMAGE', adjustmentDate: future, items: [{ product: id, qty: -1 }] })).toBe(false);
    expect(ok(grnLineSchema, { product: id, receivedQty: 5, rejectedQty: 6 })).toBe(false);
    expect(ok(grnLineSchema, { product: id, receivedQty: 5, rejectedQty: 2 })).toBe(true);
  });

  test("the sale tax rate is the product's, whatever the request says", () => {
    const product = { _id: id, sellingPrice: 275, mrp: 285, gstRate: 12, unit: 'PCS', packUnits: [] };
    expect(resolveLinePricing(product, null, { qty: 1, taxRate: 0 }).taxRate).toBe(12);
    expect(resolveLinePricing(product, null, { qty: 1, taxRate: 28 }).taxRate).toBe(12);
  });
});
