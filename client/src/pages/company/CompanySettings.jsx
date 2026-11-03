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
import { useCountries, useStates, findCountry } from '@/hooks/useLocations';
import { formatDate } from '@/utils/format';
import { cn } from '@/utils/cn';

const REGIME_LABELS = { GST: 'GST', VAT: 'VAT', SALES_TAX: 'Sales tax', NONE: 'No tax' };
const regimeLabel = (r) => REGIME_LABELS[r] || r || '—';

/** One option per currency used by any country, with its symbol. */
const currencyOptions = (countries) => {
  const map = new Map();
  countries.forEach((c) => {
    if (c.currency && !map.has(c.currency)) map.set(c.currency, c.currencySymbol || c.currency);
  });
  return [...map.entries()].map(([code, symbol]) => ({ code, symbol })).sort((a, b) => a.code.localeCompare(b.code));
};

/** Time zones grouped: the company's country first, then every zone the browser knows. */
const timezoneOptions = (country) => {
  let all = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    all = ['UTC'];
  }
  const local = (country?.timezones || []).filter(Boolean);
  const rest = all.filter((tz) => !local.includes(tz));
  return [
    ...(local.length ? [{ label: country.name, zones: local }] : []),
    { label: 'All time zones', zones: rest.includes('UTC') ? rest : ['UTC', ...rest] },
  ];
};

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
  profile: z.object({
    legalName: str(200),
    businessType: z.enum(['RETAIL', 'WHOLESALE', 'BOTH']),
    email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
    phone: z.string().trim().regex(/^[+\d\s-]*$/, 'Digits, spaces, + and - only').max(20),
    website: str(200),
    gstin: str(30),
    pan: str(20),
    taxId: str(40),
  }),
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
    regime: z.enum(['GST', 'VAT', 'SALES_TAX', 'NONE']),
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
  profile: {
    legalName: data?.company?.legalName || '',
    businessType: data?.company?.businessType || 'BOTH',
    email: data?.company?.email || '',
    phone: data?.company?.phone || '',
    website: data?.company?.website || '',
    gstin: data?.company?.gstin || '',
    pan: data?.company?.pan || '',
    taxId: data?.company?.taxId || '',
  },
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
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toDefaults(data) });

  // The company's country drives tax labels, time zone suggestions and the
  // "apply country defaults" action.
  const { data: countries = [] } = useCountries();
  const country = findCountry(countries, watch('address.country'));
  const { data: states = [] } = useStates(country?.code);
  const regime = watch('tax.regime');
  const currencies = useMemo(() => currencyOptions(countries), [countries]);
  const timezones = useMemo(() => timezoneOptions(country), [country]);
  const taxIdLabel = country?.tax?.taxIdLabel || 'Tax registration number';
  const isIndia = country?.code === 'IN';

  // ---- Locks: these settings freeze once the company has transactions -----
  const locks = data?.locks || {};
  const lockReason = (key) => {
    if (locks.hard?.includes(key)) return `🔒 Locked: ${locks.transactions} transaction(s) already use it`;
    if (locks.support?.includes(key) && !locks.canEditSupport) return '🔒 Locked: ask your service provider to change it';
    return undefined;
  };
  const lockProps = (key, className = '') =>
    lockReason(key)
      ? { 'aria-disabled': true, tabIndex: -1, className: cn(className, 'pointer-events-none bg-muted/60 text-muted-foreground') }
      : { className };

  // Before the first transaction a country change is a registration fix, so
  // its currency, time zone and tax come along. After that it is locked.
  const onCountryChange = (next) => {
    if (!next || locks.locked) return;
    const opts = { shouldDirty: true };
    if (next.currency) {
      setValue('currency', next.currency, opts);
      setValue('currencySymbol', next.currencySymbol || next.currency, opts);
    }
    if (next.timezones?.[0]) setValue('timezone', next.timezones[0], opts);
    setValue('tax.regime', next.tax?.regime || 'VAT', opts);
    setValue('tax.taxLabel', next.tax?.label || 'Tax', opts);
    setValue('tax.defaultTaxRate', String(next.tax?.regime === 'NONE' ? 0 : next.tax?.defaultRate ?? 0), opts);
    setValue('tax.enableCgstSgst', Boolean(next.tax?.splitIntraState), opts);
    setValue('tax.placeOfSupply', '', opts);
    toast.success(`Currency, time zone and tax set for ${next.name}. Review and save.`);
  };

  const onCurrency = (e) => {
    const code = e.target.value;
    setValue('currency', code, { shouldDirty: true });
    const match = currencies.find((c) => c.code === code);
    if (match) setValue('currencySymbol', match.symbol, { shouldDirty: true });
  };

  const onSubmit = async (values) => {
    setFormError('');
    const payload = {
      displayName: values.displayName,
      logo: values.logo,
      profile: values.profile,
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
            currency: next.currency || company.currency,
            currencySymbol: next.currencySymbol || company.currencySymbol,
            timezone: next.timezone || company.timezone,
            country: next.address?.country || company.country,
          });
          useAuthStore.getState().setSettings?.({
            ...(useAuthStore.getState().settings || {}),
            currency: next.currency,
            currencySymbol: next.currencySymbol,
            dateFormat: next.dateFormat,
            timezone: next.timezone,
            tax: next.tax,
            invoice: next.invoice,
            order: next.order,
            fieldForce: next.fieldForce,
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
            <CardTitle>Registration details</CardTitle>
            <CardDescription>Captured when your company was registered. Shown on invoices and documents.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid gap-x-6 gap-y-3 rounded-lg border bg-muted/30 p-4 text-sm sm:grid-cols-3">
              {[
                ['Company code', data?.company?.code],
                ['Registered name', data?.company?.businessName],
                ['Plan', data?.company?.plan?.name],
                ['Status', data?.company?.status],
                ['Registered on', data?.company?.registeredAt ? formatDate(data.company.registeredAt) : ''],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-medium">{value || '—'}</dd>
                </div>
              ))}
            </dl>
            <p className="-mt-3 text-xs text-muted-foreground">
              Company code and registered name are managed by your service provider.
            </p>

            <FormSection>
              <Field label="Legal name" error={errors.profile?.legalName?.message}>
                <Input {...register('profile.legalName')} placeholder="As per registration certificate" {...readOnly} />
              </Field>
              <Field label="Business type" error={errors.profile?.businessType?.message}>
                <Select {...register('profile.businessType')} {...readOnly}>
                  <option value="RETAIL">Retail</option>
                  <option value="WHOLESALE">Wholesale / distribution</option>
                  <option value="BOTH">Retail &amp; wholesale</option>
                </Select>
              </Field>
              <Field label="Display name" error={errors.displayName?.message} hint="Defaults to your registered company name">
                <Input {...register('displayName')} placeholder={data?.company?.businessName || ''} {...readOnly} />
              </Field>
              <Field label="Logo URL" error={errors.logo?.message} hint="Square PNG or SVG up to 2 MB">
                <Input {...register('logo')} placeholder="https://cdn.example.com/logo.png" {...readOnly} />
              </Field>
            </FormSection>

            <FormSection title="Contact">
              <Field label="Company email" error={errors.profile?.email?.message}>
                <Input type="email" {...register('profile.email')} placeholder="accounts@company.com" {...readOnly} />
              </Field>
              <Field label="Company phone" error={errors.profile?.phone?.message}>
                <Input inputMode="tel" {...register('profile.phone')} placeholder={`${country?.phoneCode || ''} 98765 43210`.trim()} {...readOnly} />
              </Field>
              <Field label="Website" error={errors.profile?.website?.message} className="sm:col-span-2">
                <Input {...register('profile.website')} placeholder="https://company.com" {...readOnly} />
              </Field>
            </FormSection>

            <FormSection title="Tax registration">
              <Field label={taxIdLabel} error={errors.profile?.gstin?.message} hint={lockReason('gstin')}>
                <Input {...register('profile.gstin')} {...readOnly} {...lockProps('gstin', 'uppercase')} />
              </Field>
              {isIndia ? (
                <Field label="PAN" error={errors.profile?.pan?.message}>
                  <Input {...register('profile.pan')} className="uppercase" placeholder="AAAAA0000A" {...readOnly} />
                </Field>
              ) : (
                <Field label="Other tax ID" error={errors.profile?.taxId?.message} hint="Optional">
                  <Input {...register('profile.taxId')} {...readOnly} />
                </Field>
              )}
            </FormSection>

            <FormSection title="Registered address">
              <AddressFields
                register={register}
                watch={watch}
                setValue={setValue}
                errors={errors}
                prefix="address"
                disabled={disabled}
                lockedFields={{ country: lockReason('country'), state: lockReason('state') }}
                onCountryChange={onCountryChange}
              />
            </FormSection>

            <FormSection title="Maintenance window">
              <Checkbox
                label="Maintenance mode"
                description="While on, only company admins can use the workspace. Everyone else is signed out and sees the message below."
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
        <LockBanner locks={locks} />
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>Localisation</CardTitle>
                <CardDescription>
                  Currency, time zone, date format and financial year
                  {country ? ` (country: ${country.name}, set in Business profile)` : ''}.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormSection>
              <Field label="Time zone" error={errors.timezone?.message}>
                <Select {...register('timezone')} {...readOnly}>
                  {timezones.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.zones.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>
              <Field label="Currency" error={errors.currency?.message} hint={lockReason('currency')}>
                <Select value={watch('currency')} onChange={onCurrency} {...readOnly} {...lockProps('currency')}>
                  {!currencies.some((c) => c.code === watch('currency')) && watch('currency') && (
                    <option value={watch('currency')}>{watch('currency')}</option>
                  )}
                  {currencies.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} ({c.symbol})
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Currency symbol" error={errors.currencySymbol?.message} hint="Filled from the currency; you can override it">
                <Input {...register('currencySymbol')} {...readOnly} />
              </Field>
              <Field
                label="Financial year starts"
                error={errors.financialYearStartMonth?.message}
                hint={lockReason('financialYearStartMonth')}
              >
                <Select {...register('financialYearStartMonth')} {...readOnly} {...lockProps('financialYearStartMonth')}>
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
        <LockBanner locks={locks} />
        <Card>
          <CardHeader>
            <CardTitle>Tax</CardTitle>
            <CardDescription>Applied to orders, invoices and credit notes by default.</CardDescription>
          </CardHeader>
          <CardContent>
            <FormSection>
              <Field
                label="Tax regime"
                error={errors.tax?.regime?.message}
                hint={lockReason('taxRegime') || (country ? `${country.name} default: ${regimeLabel(country.tax?.regime)}` : undefined)}
              >
                <Select {...register('tax.regime')} {...readOnly} {...lockProps('taxRegime')}>
                  <option value="GST">GST</option>
                  <option value="VAT">VAT</option>
                  <option value="SALES_TAX">Sales tax</option>
                  <option value="NONE">No tax</option>
                </Select>
              </Field>
              <Field label="Tax label" error={errors.tax?.taxLabel?.message} hint="Printed on documents, e.g. GST, VAT, TVA">
                <Input {...register('tax.taxLabel')} placeholder={country?.tax?.label || 'Tax'} {...readOnly} />
              </Field>
              <Field
                label="Default tax rate (%)"
                error={errors.tax?.defaultTaxRate?.message}
                hint={regime === 'NONE' ? 'No tax is charged' : `Used when a product has no rate. Max ${country?.tax?.maxRate ?? 100}%`}
              >
                <Input
                  type="number"
                  min="0"
                  max={country?.tax?.maxRate ?? 100}
                  step="0.01"
                  {...register('tax.defaultTaxRate')}
                  {...readOnly}
                  disabled={disabled || regime === 'NONE'}
                />
              </Field>
              <Field
                label="Your state (place of supply)"
                error={errors.tax?.placeOfSupply?.message}
                hint={lockReason('placeOfSupply') || 'Sales to the same state are intra-state'}
              >
                <Select
                  {...register('tax.placeOfSupply')}
                  {...readOnly}
                  disabled={disabled || regime === 'NONE'}
                  {...lockProps('placeOfSupply')}
                >
                  <option value="">Same as registered address</option>
                  {states.map((st) => (
                    <option key={st.code} value={st.name}>
                      {st.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Checkbox
                  label="Prices include tax"
                  description={lockReason('taxInclusive') || 'Entered prices already contain tax; it is backed out on documents.'}
                  {...register('tax.taxInclusive')}
                  disabled={disabled || regime === 'NONE'}
                  {...lockProps('taxInclusive')}
                />
                {regime === 'GST' && (
                  <Checkbox
                    label="Split same-state tax (CGST + SGST)"
                    description={lockReason('splitTax') || 'Same-state sales show CGST + SGST; other states show IGST.'}
                    {...register('tax.enableCgstSgst')}
                    disabled={disabled}
                    {...lockProps('splitTax')}
                  />
                )}
              </div>
              {isIndia && regime === 'GST' && (
                <div className="space-y-2 rounded-lg border border-dashed p-3 sm:col-span-2">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">E-invoicing (IRN)</p>
                    <Badge tone="muted">Coming soon</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Generating IRN and signed QR codes needs a GST suvidha provider (GSP) connection, which is not set up yet.
                  </p>
                </div>
              )}
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
                  <option value="NEAREST">Nearest whole unit</option>
                  <option value="DOWN">Round down</option>
                  <option value="NONE">No rounding</option>
                </Select>
              </Field>
              {isIndia && (
                <Field label="UPI ID" error={errors.invoice?.upiVpa?.message} hint="Printed on invoices as a scan-to-pay QR for the balance">
                  <Input {...register('invoice.upiVpa')} placeholder="company@upi" {...readOnly} />
                </Field>
              )}
              <Field label="Terms & conditions" error={errors.invoice?.terms?.message} className="sm:col-span-2">
                <Textarea {...register('invoice.terms')} {...readOnly} />
              </Field>
              <Field label="Footer note" error={errors.invoice?.footerNote?.message} className="sm:col-span-2">
                <Input {...register('invoice.footerNote')} {...readOnly} />
              </Field>
              <div className="space-y-2 sm:col-span-2">
                {isIndia && (
                  <Checkbox label="Show UPI QR on invoices" {...register('invoice.showQr')} disabled={disabled} />
                )}
                <Checkbox label={`Show company ${taxIdLabel}`} {...register('invoice.showGstin')} disabled={disabled} />
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
              <ComingSoon
                className="sm:col-span-2"
                title="Stock valuation method & batch expiry"
                text="Stock is valued at the last purchase cost today. FIFO / weighted-average valuation and batch-wise expiry tracking are planned."
              />
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
              <Field
                label="Remind after (days overdue)"
                error={errors.collections?.overdueReminderDays?.message}
                hint="0 = remind on the day after the due date"
              >
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
              </div>
              <ComingSoon
                className="sm:col-span-2"
                title="Selfie at check-in & live location tracking"
                text="Check-ins record GPS today. Selfie capture and continuous location tracking need the mobile app and are planned."
              />
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
// Human names for the permission keys ("creditnotes.cancel" -> Credit notes / Cancel).
const MODULE_LABELS = {
  dashboard: 'Dashboard',
  users: 'Users & teams',
  customers: 'Customers',
  products: 'Products',
  orders: 'Sales orders',
  invoices: 'Invoices',
  creditnotes: 'Credit notes',
  payments: 'Payments & collections',
  inventory: 'Inventory',
  purchases: 'Purchase orders',
  grn: 'Goods receipts (GRN)',
  fieldforce: 'Field force',
  reports: 'Reports',
  settings: 'Company settings',
  audit: 'Audit trail',
};
const AREA_LABELS = {
  adjustments: 'Stock adjustments',
  transfers: 'Stock transfers',
  attendance: 'Attendance',
  visits: 'Visits',
  expenses: 'Expenses',
  targets: 'Targets',
};
const ACTION_LABELS = {
  view: 'View',
  create: 'Create',
  update: 'Edit',
  delete: 'Delete',
  export: 'Export',
  approve: 'Approve',
  cancel: 'Cancel',
  manage: 'Manage',
  post: 'Post',
};
const ACTION_ORDER = ['view', 'create', 'update', 'delete', 'manage', 'approve', 'post', 'cancel', 'export'];
const humanize = (word) => word.charAt(0).toUpperCase() + word.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase();
const moduleLabel = (module) => MODULE_LABELS[module] || humanize(module);
const permissionLabel = (key) => {
  const [, ...rest] = key.split('.');
  const action = rest.pop();
  const area = rest.length ? `${AREA_LABELS[rest[0]] || humanize(rest[0])} · ` : '';
  return `${area}${ACTION_LABELS[action] || humanize(action || '')}`;
};

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
    // Within a module: module-level actions first, then each area; actions in
    // a natural order (View, Create, Edit, Delete, ...).
    const rank = (key) => {
      const parts = key.split('.');
      const action = parts[parts.length - 1];
      const area = parts.length > 2 ? parts[1] : '';
      const i = ACTION_ORDER.indexOf(action);
      return `${area}|${String(i === -1 ? 99 : i).padStart(2, '0')}`;
    };
    Object.values(out).forEach((keys) => keys.sort((a, b) => rank(a).localeCompare(rank(b))));
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
                    {role.charAt(0) + role.slice(1).toLowerCase().replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.entries(groups).flatMap(([module, permissions]) => {
                const header = (
                  <tr key={`group-${module}`} className="border-b bg-muted/40">
                    <td colSpan={roles.length + 1} className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide">
                      {moduleLabel(module)}
                    </td>
                  </tr>
                );
                const rows = permissions.map((permission) => (
                  <tr key={permission} className="border-b last:border-0 hover:bg-accent/40">
                    <td className="sticky left-0 bg-card px-2 py-1.5 text-sm" title={permission}>
                      {permissionLabel(permission)}
                    </td>
                    {roles.map((role) => {
                      const checked = role === 'COMPANY_ADMIN' || (matrix[permission] || []).includes(role);
                      return (
                        <td key={role} className="px-2 py-1.5 text-center">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!canUpdate || role === 'COMPANY_ADMIN'}
                            onChange={() => toggle(permission, role)}
                            aria-label={`${moduleLabel(permission.split('.')[0])}: ${permissionLabel(permission)} for ${role.replace(/_/g, ' ')}`}
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

/** Explains why some fields cannot be edited any more. */
function LockBanner({ locks }) {
  if (!locks?.locked) return null;
  return (
    <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <p className="font-medium">🔒 Some settings are locked</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        This company already has {locks.transactions} transaction(s). Currency, country, financial year and tax regime can
        no longer change, because saved documents depend on them. Tax registration number, registered state and tax
        options can only be changed by your service provider.
      </p>
    </div>
  );
}

/** Placeholder for a setting whose feature is not built yet (no fake toggles). */
function ComingSoon({ title, text, className }) {
  return (
    <div className={`space-y-1 rounded-lg border border-dashed p-3 ${className || ''}`}>
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{title}</p>
        <Badge tone="muted">Coming soon</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{text}</p>
    </div>
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
