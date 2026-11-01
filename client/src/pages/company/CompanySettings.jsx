import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Save, ShieldCheck } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/dialog';
import { ErrorAlert } from '@/components/ui/alert';
import { LoadingState } from '@/components/ui/misc';
import { AddressFields, FormSection, num, opt } from '@/components/company/form-utils';
import { useLookups } from '@/hooks/useLookups';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuthStore } from '@/store/authStore';

const PAYMENT_TERMS = ['IMMEDIATE', 'NET_7', 'NET_15', 'NET_30', 'NET_45', 'NET_60', 'CUSTOM'];

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const SERIES_FIELDS = [
  { key: 'order', label: 'Sales order' },
  { key: 'invoice', label: 'Invoice' },
  { key: 'creditNote', label: 'Credit note' },
  { key: 'payment', label: 'Payment receipt' },
  { key: 'purchase', label: 'Purchase order' },
  { key: 'grn', label: 'Goods receipt (GRN)' },
  { key: 'customer', label: 'Customer code' },
  { key: 'supplier', label: 'Supplier code' },
];

const TABS = [
  { value: 'profile', label: 'Business profile' },
  { value: 'localisation', label: 'Localisation & numbering' },
  { value: 'documents', label: 'Tax & documents' },
  { value: 'operations', label: 'Operations' },
  { value: 'permissions', label: 'Permissions', icon: ShieldCheck },
];

const str = (max = 500) => z.string().trim().max(max).optional().or(z.literal(''));

const schema = z.object({
  displayName: str(160),
  logo: str(500),
  address: z.object({
    line1: str(160),
    line2: str(160),
    city: str(80),
    state: str(80),
    pincode: str(12),
    country: str(80),
  }),
  maintenanceMode: z.boolean(),
  maintenanceMessage: str(500),

  timezone: str(60),
  currency: str(8),
  currencySymbol: str(4),
  financialYearStartMonth: str(2),
  dateFormat: str(20),

  series: z.record(
    z.object({
      prefix: str(10),
      pad: str(3),
    })
  ),

  tax: z.object({
    regime: z.enum(['GST', 'VAT', 'NONE']),
    defaultTaxRate: str(6),
    taxInclusive: z.boolean(),
    placeOfSupply: str(80),
    enableCgstSgst: z.boolean(),
    eInvoiceEnabled: z.boolean(),
    eInvoiceGstin: str(20),
    taxLabel: str(20),
  }),

  invoice: z.object({
    terms: str(2000),
    footerNote: str(500),
    defaultDueDays: str(4),
    showQr: z.boolean(),
    upiVpa: str(80),
    showGstin: z.boolean(),
    rounding: z.enum(['NEAREST', 'DOWN', 'NONE']),
    defaultPaymentTerms: z.enum(PAYMENT_TERMS),
    allowDirectInvoice: z.boolean(),
  }),

  order: z.object({
    approvalThreshold: str(14),
    creditLimitAction: z.enum(['WARN', 'BLOCK', 'NONE']),
    reserveStockOnConfirm: z.boolean(),
    allowNegativeStock: z.boolean(),
    defaultPaymentMode: z.enum(['CASH', 'CREDIT']),
    showStockOnOrder: z.boolean(),
  }),

  inventory: z.object({
    defaultWarehouse: str(40),
    lowStockThreshold: str(10),
    valuationMethod: z.enum(['FIFO', 'AVERAGE', 'LIFO']),
    batchExpiry: z.boolean(),
  }),

  collections: z.object({
    overdueReminderDays: str(3),
    sendOverdueReminders: z.boolean(),
    fifoAllocationDefault: z.boolean(),
  }),

  fieldForce: z.object({
    geofenceRadiusM: str(6),
    requireGps: z.boolean(),
    requireSelfie: z.boolean(),
    trackLiveLocation: z.boolean(),
    workStart: str(5),
    workEnd: str(5),
  }),
});

const toDefaults = (data) => ({
  displayName: data?.displayName || '',
  logo: data?.logo || '',
  address: {
    line1: data?.address?.line1 || '',
    line2: data?.address?.line2 || '',
    city: data?.address?.city || '',
    state: data?.address?.state || '',
    pincode: data?.address?.pincode || '',
    country: data?.address?.country || 'India',
  },
  maintenanceMode: data?.maintenanceMode ?? false,
  maintenanceMessage: data?.maintenanceMessage || '',

  timezone: data?.timezone || 'Asia/Kolkata',
  currency: data?.currency || 'INR',
  currencySymbol: data?.currencySymbol || '₹',
  financialYearStartMonth: String(data?.financialYearStartMonth ?? 4),
  dateFormat: data?.dateFormat || 'DD/MM/YYYY',

  series: Object.fromEntries(
    SERIES_FIELDS.map(({ key }) => [
      key,
      {
        prefix: data?.series?.[key]?.prefix || '',
        pad: String(data?.series?.[key]?.pad ?? 6),
      },
    ])
  ),

  tax: {
    regime: data?.tax?.regime || 'GST',
    defaultTaxRate: String(data?.tax?.defaultTaxRate ?? 18),
    taxInclusive: data?.tax?.taxInclusive ?? false,
    placeOfSupply: data?.tax?.placeOfSupply || '',
    enableCgstSgst: data?.tax?.enableCgstSgst ?? true,
    eInvoiceEnabled: data?.tax?.eInvoiceEnabled ?? false,
    eInvoiceGstin: data?.tax?.eInvoiceGstin || '',
    taxLabel: data?.tax?.taxLabel || 'GST',
  },

  invoice: {
    terms: data?.invoice?.terms || '',
    footerNote: data?.invoice?.footerNote || '',
    defaultDueDays: String(data?.invoice?.defaultDueDays ?? 0),
    showQr: data?.invoice?.showQr ?? true,
    upiVpa: data?.invoice?.upiVpa || '',
    showGstin: data?.invoice?.showGstin ?? true,
    rounding: data?.invoice?.rounding || 'NEAREST',
    defaultPaymentTerms: data?.invoice?.defaultPaymentTerms || 'IMMEDIATE',
    allowDirectInvoice: data?.invoice?.allowDirectInvoice ?? true,
  },

  order: {
    approvalThreshold: String(data?.order?.approvalThreshold ?? 0),
    creditLimitAction: data?.order?.creditLimitAction || 'WARN',
    reserveStockOnConfirm: data?.order?.reserveStockOnConfirm ?? true,
    allowNegativeStock: data?.order?.allowNegativeStock ?? false,
    defaultPaymentMode: data?.order?.defaultPaymentMode || 'CREDIT',
    showStockOnOrder: data?.order?.showStockOnOrder ?? true,
  },

  inventory: {
    defaultWarehouse: data?.inventory?.defaultWarehouse?.id || data?.inventory?.defaultWarehouse || '',
    lowStockThreshold: String(data?.inventory?.lowStockThreshold ?? 10),
    valuationMethod: data?.inventory?.valuationMethod || 'FIFO',
    batchExpiry: data?.inventory?.batchExpiry ?? false,
  },

  collections: {
    overdueReminderDays: String(data?.collections?.overdueReminderDays ?? 3),
    sendOverdueReminders: data?.collections?.sendOverdueReminders ?? true,
    fifoAllocationDefault: data?.collections?.fifoAllocationDefault ?? true,
  },

  fieldForce: {
    geofenceRadiusM: String(data?.fieldForce?.geofenceRadiusM ?? 100),
    requireGps: data?.fieldForce?.requireGps ?? true,
    requireSelfie: data?.fieldForce?.requireSelfie ?? false,
    trackLiveLocation: data?.fieldForce?.trackLiveLocation ?? true,
    workStart: data?.fieldForce?.workStart || '09:30',
    workEnd: data?.fieldForce?.workEnd || '18:30',
  },
});

function SettingsForm({ data, canUpdate, tab }) {
  const queryClient = useQueryClient();
  const { lookups } = useLookups();
  const [formError, setFormError] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toDefaults(data) });

  const onSubmit = async (values) => {
    setFormError('');
    const payload = {
      displayName: values.displayName,
      logo: values.logo,
      address: values.address,
      maintenanceMode: values.maintenanceMode,
      maintenanceMessage: values.maintenanceMessage,

      timezone: values.timezone,
      currency: values.currency,
      currencySymbol: values.currencySymbol,
      financialYearStartMonth: num(values.financialYearStartMonth),
      dateFormat: values.dateFormat,

      series: Object.fromEntries(
        SERIES_FIELDS.map(({ key }) => [
          key,
          { prefix: values.series?.[key]?.prefix || '', pad: num(values.series?.[key]?.pad) },
        ])
      ),

      tax: { ...values.tax, defaultTaxRate: num(values.tax.defaultTaxRate) },
      invoice: { ...values.invoice, defaultDueDays: num(values.invoice.defaultDueDays) },
      order: { ...values.order, approvalThreshold: num(values.order.approvalThreshold) },
      inventory: {
        ...values.inventory,
        defaultWarehouse: opt(values.inventory.defaultWarehouse),
        lowStockThreshold: num(values.inventory.lowStockThreshold),
      },
      collections: {
        ...values.collections,
        overdueReminderDays: num(values.collections.overdueReminderDays),
      },
      fieldForce: {
        ...values.fieldForce,
        geofenceRadiusM: num(values.fieldForce.geofenceRadiusM),
      },
    };

    try {
      const res = await api.patch('/v1/settings', payload);
      toast.success('Settings saved');
      const next = res.data?.data;
      if (next) reset(toDefaults(next));
      if (next) {
        // Merge, never replace: the PATCH payload carries only the editable
        // sections, while the permission matrix needs roles + the catalog.
        queryClient.setQueryData(['company', 'settings'], (old) => (old ? { ...old, ...next } : next));
      }
      if (next) {
        // Editing the display name must be visible in the workspace header
        // straight away, without a re-login.
        const { company, setCompany } = useAuthStore.getState();
        if (company) {
          setCompany({
            ...company,
            name: next.displayName?.trim() || company.businessName || company.name,
            displayName: next.displayName || '',
          });
        }
      }
      queryClient.invalidateQueries({ queryKey: ['company', 'dashboard'] });
    } catch (err) {
      setFormError(apiError(err).message);
    }
  };

  const disabled = !canUpdate;
  const readOnly = disabled ? { disabled: true } : {};

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {formError && <ErrorAlert title="Could not save settings" message={formError} onClose={() => setFormError('')} />}

      {/* ---------------- Profile ---------------- */}
      <div hidden={tab !== 'profile'}>
        <Card>
          <CardHeader>
            <CardTitle>Business profile</CardTitle>
            <CardDescription>Shown on invoices, documents and the workspace header.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormSection>
              <Field label="Display name" error={errors.displayName?.message} hint="Defaults to your registered company name">
                <Input {...register('displayName')} placeholder="Demo Traders Pvt Ltd" {...readOnly} />
              </Field>
              <Field label="Logo URL" error={errors.logo?.message} hint="Square PNG or SVG up to 2 MB">
                <Input {...register('logo')} placeholder="https://cdn.example.com/logo.png" {...readOnly} />
              </Field>
              <AddressFields register={register} errors={errors} prefix="address" />
            </FormSection>

            <FormSection title="Maintenance window">
              <Checkbox
                label="Maintenance mode"
                description="Only company admins can sign in while maintenance mode is on."
                {...register('maintenanceMode')}
                disabled={disabled}
              />
              <Field label="Maintenance message" error={errors.maintenanceMessage?.message} className="sm:col-span-2">
                <Input
                  {...register('maintenanceMessage')}
                  placeholder="We are upgrading our systems. Please check back at 11:00."
                  {...readOnly}
                />
              </Field>
            </FormSection>
          </CardContent>
        </Card>
      </div>

      {/* ---------------- Localisation & numbering ---------------- */}
      <div hidden={tab !== 'localisation'}>
        <Card>
          <CardHeader>
            <CardTitle>Localisation</CardTitle>
            <CardDescription>Currency, time zone and financial year.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormSection>
              <Field label="Time zone" error={errors.timezone?.message}>
                <Input {...register('timezone')} placeholder="Asia/Kolkata" list="timezones" {...readOnly} />
              </Field>
              <datalist id="timezones">
                {['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'].map(
                  (tz) => (
                    <option key={tz} value={tz} />
                  )
                )}
              </datalist>
              <Field label="Currency" error={errors.currency?.message}>
                <Input {...register('currency')} placeholder="INR" className="uppercase" {...readOnly} />
              </Field>
              <Field label="Currency symbol" error={errors.currencySymbol?.message}>
                <Input {...register('currencySymbol')} placeholder="₹" {...readOnly} />
              </Field>
              <Field label="Financial year starts" error={errors.financialYearStartMonth?.message}>
                <Select {...register('financialYearStartMonth')} {...readOnly}>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Date format" error={errors.dateFormat?.message}>
                <Select {...register('dateFormat')} {...readOnly}>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </Select>
              </Field>
            </FormSection>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Document numbering</CardTitle>
            <CardDescription>Prefixes and zero-padding used by every generated number series.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {SERIES_FIELDS.map(({ key, label }) => (
                <div key={key} className="rounded-lg border p-3">
                  <p className="mb-2 text-sm font-medium">{label}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Prefix" error={errors.series?.[key]?.prefix?.message}>
                      <Input
                        {...register(`series.${key}.prefix`)}
                        placeholder="SO"
                        className="uppercase"
                        {...readOnly}
                      />
                    </Field>
                    <Field label="Digits" error={errors.series?.[key]?.pad?.message}>
                      <Input type="number" min="1" max="12" {...register(`series.${key}.pad`)} {...readOnly} />
                    </Field>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ---------------- Tax & documents ---------------- */}
      <div hidden={tab !== 'documents'}>
        <Card>
          <CardHeader>
            <CardTitle>Tax</CardTitle>
            <CardDescription>Applied to orders, invoices and credit notes by default.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSection>
              <Field label="Tax regime" error={errors.tax?.regime?.message}>
                <Select {...register('tax.regime')} {...readOnly}>
                  <option value="GST">GST (India)</option>
                  <option value="VAT">VAT</option>
                  <option value="NONE">No tax</option>
                </Select>
              </Field>
              <Field label="Default tax rate (%)" error={errors.tax?.defaultTaxRate?.message}>
                <Input type="number" min="0" max="28" step="0.01" {...register('tax.defaultTaxRate')} {...readOnly} />
              </Field>
              <Field label="Tax label" error={errors.tax?.taxLabel?.message} hint="Printed on documents">
                <Input {...register('tax.taxLabel')} placeholder="GST" {...readOnly} />
              </Field>
              <Field label="Place of supply" error={errors.tax?.placeOfSupply?.message}>
                <Input {...register('tax.placeOfSupply')} placeholder="Maharashtra" {...readOnly} />
              </Field>
              <Field label="E-invoice GSTIN" error={errors.tax?.eInvoiceGstin?.message}>
                <Input {...register('tax.eInvoiceGstin')} placeholder="27AAAAA0000A1Z5" className="uppercase" {...readOnly} />
              </Field>
              <div className="space-y-2">
                <Checkbox label="Prices include tax" {...register('tax.taxInclusive')} disabled={disabled} />
                <Checkbox label="Split into CGST + SGST" {...register('tax.enableCgstSgst')} disabled={disabled} />
                <Checkbox label="Enable e-invoicing" {...register('tax.eInvoiceEnabled')} disabled={disabled} />
              </div>
            </FormSection>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Invoicing</CardTitle>
            <CardDescription>Defaults used when an invoice is generated.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSection>
              <Field label="Default due days" error={errors.invoice?.defaultDueDays?.message}>
                <Input type="number" min="0" max="365" {...register('invoice.defaultDueDays')} {...readOnly} />
              </Field>
              <Field label="Default payment terms" error={errors.invoice?.defaultPaymentTerms?.message}>
                <Select {...register('invoice.defaultPaymentTerms')} {...readOnly}>
                  {PAYMENT_TERMS.map((t) => (
                    <option key={t} value={t}>
                      {t === 'IMMEDIATE' ? 'Immediate' : t.replace('NET_', 'Net ')}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Rounding" error={errors.invoice?.rounding?.message}>
                <Select {...register('invoice.rounding')} {...readOnly}>
                  <option value="NEAREST">Nearest rupee</option>
                  <option value="DOWN">Round down</option>
                  <option value="NONE">No rounding</option>
                </Select>
              </Field>
              <Field label="UPI VPA" error={errors.invoice?.upiVpa?.message} hint="Printed as a payment QR">
                <Input {...register('invoice.upiVpa')} placeholder="company@upi" {...readOnly} />
              </Field>
              <Field label="Terms & conditions" error={errors.invoice?.terms?.message} className="sm:col-span-2">
                <Textarea {...register('invoice.terms')} {...readOnly} />
              </Field>
              <Field label="Footer note" error={errors.invoice?.footerNote?.message} className="sm:col-span-2">
                <Input {...register('invoice.footerNote')} {...readOnly} />
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Checkbox label="Show UPI QR on invoices" {...register('invoice.showQr')} disabled={disabled} />
                <Checkbox label="Show company GSTIN" {...register('invoice.showGstin')} disabled={disabled} />
                <Checkbox
                  label="Allow invoicing without an order"
                  {...register('invoice.allowDirectInvoice')}
                  disabled={disabled}
                />
              </div>
            </FormSection>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Order rules</CardTitle>
            <CardDescription>Approvals and stock behaviour when booking orders.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSection>
              <Field
                label="Approval threshold"
                error={errors.order?.approvalThreshold?.message}
                hint="Orders above this value need manager approval. 0 disables."
              >
                <Input type="number" min="0" step="0.01" {...register('order.approvalThreshold')} {...readOnly} />
              </Field>
              <Field label="When credit limit is exceeded" error={errors.order?.creditLimitAction?.message}>
                <Select {...register('order.creditLimitAction')} {...readOnly}>
                  <option value="WARN">Warn the salesman</option>
                  <option value="BLOCK">Block the order</option>
                  <option value="NONE">Allow silently</option>
                </Select>
              </Field>
              <Field label="Default payment mode" error={errors.order?.defaultPaymentMode?.message}>
                <Select {...register('order.defaultPaymentMode')} {...readOnly}>
                  <option value="CREDIT">Credit</option>
                  <option value="CASH">Cash</option>
                </Select>
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Checkbox label="Reserve stock when an order is confirmed" {...register('order.reserveStockOnConfirm')} disabled={disabled} />
                <Checkbox label="Allow negative stock" {...register('order.allowNegativeStock')} disabled={disabled} />
                <Checkbox label="Show live stock while taking an order" {...register('order.showStockOnOrder')} disabled={disabled} />
              </div>
            </FormSection>
          </CardContent>
        </Card>
      </div>

      {/* ---------------- Operations ---------------- */}
      <div hidden={tab !== 'operations'}>
        <Card>
          <CardHeader>
            <CardTitle>Inventory</CardTitle>
            <CardDescription>Stock valuation, alerts and the default warehouse.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSection>
              <Field label="Default warehouse" error={errors.inventory?.defaultWarehouse?.message}>
                <Select {...register('inventory.defaultWarehouse')} {...readOnly}>
                  <option value="">Not set</option>
                  {lookups.warehouses.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.code})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Low stock threshold" error={errors.inventory?.lowStockThreshold?.message}>
                <Input type="number" min="0" step="1" {...register('inventory.lowStockThreshold')} {...readOnly} />
              </Field>
              <Field label="Valuation method" error={errors.inventory?.valuationMethod?.message}>
                <Select {...register('inventory.valuationMethod')} {...readOnly}>
                  <option value="FIFO">FIFO</option>
                  <option value="AVERAGE">Weighted average</option>
                  <option value="LIFO">LIFO</option>
                </Select>
              </Field>
              <Checkbox label="Track batch expiry" {...register('inventory.batchExpiry')} disabled={disabled} />
            </FormSection>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Collections</CardTitle>
            <CardDescription>Overdue reminders and payment allocation.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSection>
              <Field label="Remind after (days overdue)" error={errors.collections?.overdueReminderDays?.message}>
                <Input type="number" min="0" max="90" {...register('collections.overdueReminderDays')} {...readOnly} />
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Checkbox label="Send overdue reminders" {...register('collections.sendOverdueReminders')} disabled={disabled} />
                <Checkbox
                  label="Allocate payments oldest invoice first (FIFO)"
                  {...register('collections.fifoAllocationDefault')}
                  disabled={disabled}
                />
              </div>
            </FormSection>
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Field force</CardTitle>
            <CardDescription>Visit check-in rules for salesmen on the road.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSection>
              <Field label="Geofence radius (metres)" error={errors.fieldForce?.geofenceRadiusM?.message}>
                <Input type="number" min="10" max="5000" {...register('fieldForce.geofenceRadiusM')} {...readOnly} />
              </Field>
              <Field label="Working hours start" error={errors.fieldForce?.workStart?.message}>
                <Input type="time" {...register('fieldForce.workStart')} {...readOnly} />
              </Field>
              <Field label="Working hours end" error={errors.fieldForce?.workEnd?.message}>
                <Input type="time" {...register('fieldForce.workEnd')} {...readOnly} />
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Checkbox label="Require GPS at check-in" {...register('fieldForce.requireGps')} disabled={disabled} />
                <Checkbox label="Require a selfie at check-in" {...register('fieldForce.requireSelfie')} disabled={disabled} />
                <Checkbox label="Track live location during work hours" {...register('fieldForce.trackLiveLocation')} disabled={disabled} />
              </div>
            </FormSection>
          </CardContent>
        </Card>
      </div>

      {tab !== 'permissions' && (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
          {isDirty && <span className="mr-auto text-xs text-muted-foreground">Unsaved changes</span>}
          <Button type="button" variant="outline" onClick={() => reset(toDefaults(data))} disabled={!isDirty || isSubmitting}>
            Discard
          </Button>
          <Button type="submit" loading={isSubmitting} disabled={!canUpdate}>
            <Save className="h-4 w-4" /> Save settings
          </Button>
        </div>
      )}
    </form>
  );
}
function PermissionsEditor({ data, canUpdate }) {
  const queryClient = useQueryClient();
  const [matrix, setMatrix] = useState(() => data.rolePermissions || {});
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const roles = data.roles || [];
  const catalog = data.permissionCatalog || {};

  const groups = useMemo(() => {
    const out = {};
    Object.keys(catalog)
      .sort()
      .forEach((key) => {
        const module = key.split('.')[0];
        out[module] = out[module] || [];
        out[module].push(key);
      });
    return out;
  }, [catalog]);

  const toggle = (permission, role) => {
    setMatrix((prev) => {
      const current = prev[permission] || [];
      const next = current.includes(role) ? current.filter((r) => r !== role) : [...current, role];
      return { ...prev, [permission]: next };
    });
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => api.put('/v1/settings/permissions', { rolePermissions: matrix }),
    onSuccess: (res) => {
      toast.success('Permissions updated');
      setDirty(false);
      queryClient.setQueryData(['company', 'settings'], (old) =>
        old ? { ...old, rolePermissions: res.data?.data?.rolePermissions || old.rolePermissions } : old
      );
      queryClient.invalidateQueries({ queryKey: ['company', 'settings'] });
    },
    onError: (err) => setError(apiError(err).message),
  });

  const resetToDefaults = useMutation({
    mutationFn: () => api.post('/v1/settings/permissions/reset'),
    onSuccess: (res) => {
      toast.success('Permissions reset to defaults');
      setMatrix(res.data?.data?.rolePermissions || {});
      setDirty(false);
      setConfirmReset(false);
      queryClient.invalidateQueries({ queryKey: ['company', 'settings'] });
    },
    onError: (err) => {
      setConfirmReset(false);
      setError(apiError(err).message);
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Role permissions</CardTitle>
            <CardDescription>
              COMPANY_ADMIN always has full access. Changes apply the next time a user signs in.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmReset(true)}
              disabled={!canUpdate || resetToDefaults.isPending}
            >
              <RotateCcw className="h-4 w-4" /> Reset defaults
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={!canUpdate || !dirty}
            >
              <Save className="h-4 w-4" /> Save permissions
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <ErrorAlert title="Could not update permissions" message={error} onClose={() => setError('')} />}
        {dirty && <p className="text-xs font-medium text-warning">You have unsaved permission changes.</p>}

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 bg-card px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Permission
                </th>
                {roles.map((role) => (
                  <th key={role} className="px-2 py-2 text-center text-xs font-semibold text-muted-foreground">
                    {role.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(groups).flatMap(([module, permissions]) => {
                const header = (
                  <tr key={`group-${module}`} className="border-b bg-muted/40">
                    <td colSpan={roles.length + 1} className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide">
                      {module}
                    </td>
                  </tr>
                );
                const rows = permissions.map((permission) => (
                  <tr key={permission} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="sticky left-0 bg-card px-2 py-1.5 font-mono text-xs">{permission}</td>
                    {roles.map((role) => {
                      const checked = role === 'COMPANY_ADMIN' || (matrix[permission] || []).includes(role);
                      return (
                        <td key={role} className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canUpdate || role === 'COMPANY_ADMIN'}
                            onChange={() => toggle(permission, role)}
                            aria-label={`${permission} for ${role}`}
                            className="h-4 w-4 rounded border-input accent-primary disabled:opacity-50"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ));
                return [header, ...rows];
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          {Object.keys(catalog).length} permissions across {Object.keys(groups).length} modules ·{' '}
          <Badge tone="muted" className="px-1.5 py-0 text-[10px]">
            {roles.length} roles
          </Badge>
        </p>
      </CardContent>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={() => resetToDefaults.mutate()}
        title="Reset permission matrix?"
        message="Every role will be restored to the shipped defaults. Custom changes will be lost."
        confirmLabel="Reset permissions"
        tone="destructive"
        loading={resetToDefaults.isPending}
      />
    </Card>
  );
}

export default function CompanySettings() {
  const { can } = usePermissions();
  const [tab, setTab] = useState('profile');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['company', 'settings'],
    queryFn: async () => {
      const res = await api.get('/v1/settings');
      return res.data?.data || {};
    },
  });

  const canUpdate = can('settings.update');

  return (
    <div className="space-y-5">
      <PageHeader
        title="Company Settings"
        description="Personalise the workspace, document defaults and role permissions"
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Company Settings' }]}
        actions={
          <Badge tone={canUpdate ? 'success' : 'muted'} dot>
            {canUpdate ? 'Editable' : 'Read only'}
          </Badge>
        }
      />

      {isLoading ? (
        <Card>
          <CardContent>
            <LoadingState label="Loading workspace settings…" />
          </CardContent>
        </Card>
      ) : isError ? (
        <Card>
          <CardContent>
            <ErrorAlert title="Could not load settings" message={apiError(error).message} />
          </CardContent>
        </Card>
      ) : (
        <>
          <Tabs items={TABS} value={tab} onChange={setTab} />
          <div hidden={tab === 'permissions'}>
            <SettingsForm data={data} canUpdate={canUpdate} tab={tab} />
          </div>
          {tab === 'permissions' && <PermissionsEditor data={data} canUpdate={canUpdate} />}
        </>
      )}
    </div>
  );
}
