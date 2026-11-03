import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { Search, Plus, Download, Save } from 'lucide-react';

import api, { apiError } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Select, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Tabs } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/alert';
import { LoadingState } from '@/components/ui/misc';
import { cn } from '@/utils/cn';

const BASE = '/platform/locations/countries';
const REGIMES = [
  ['GST', 'GST'],
  ['VAT', 'VAT'],
  ['SALES_TAX', 'Sales tax'],
  ['NONE', 'No tax'],
];

const rate = z.coerce.number().min(0, 'Min 0').max(100, 'Max 100');
const schema = z.object({
  currency: z.string().trim().toUpperCase().max(3),
  currencySymbol: z.string().trim().max(6),
  phoneCode: z.string().trim().max(8),
  timezones: z.string().max(2000),
  tax: z.object({
    regime: z.enum(['GST', 'VAT', 'SALES_TAX', 'NONE']),
    label: z.string().trim().min(1, 'Required').max(30),
    taxIdLabel: z.string().trim().min(1, 'Required').max(30),
    defaultRate: rate,
    maxRate: rate,
    splitIntraState: z.boolean(),
  }),
  postalCode: z.object({
    label: z.string().trim().min(1, 'Required').max(30),
    numeric: z.boolean(),
    length: z.string().trim().regex(/^\d{0,2}$/, 'Digits only'),
    pattern: z.string().max(120),
  }),
});

const toForm = (c) => ({
  currency: c.currency || '',
  currencySymbol: c.currencySymbol || '',
  phoneCode: c.phoneCode || '',
  timezones: (c.timezones || []).join('\n'),
  tax: {
    regime: c.tax?.regime || 'VAT',
    label: c.tax?.label || 'Tax',
    taxIdLabel: c.tax?.taxIdLabel || 'Tax ID',
    defaultRate: c.tax?.defaultRate ?? 0,
    maxRate: c.tax?.maxRate ?? 100,
    splitIntraState: Boolean(c.tax?.splitIntraState),
  },
  postalCode: {
    label: c.postalCode?.label || 'Postal code',
    numeric: Boolean(c.postalCode?.numeric),
    length: c.postalCode?.length ? String(c.postalCode.length) : '',
    pattern: c.postalCode?.pattern || '',
  },
});

function CountryDefaults({ country, onSaved }) {
  const [error, setError] = useState('');
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toForm(country) });

  useEffect(() => reset(toForm(country)), [country, reset]);
  const regime = watch('tax.regime');

  const onSubmit = async (v) => {
    setError('');
    try {
      await api.patch(`${BASE}/${country.code}`, {
        currency: v.currency,
        currencySymbol: v.currencySymbol,
        phoneCode: v.phoneCode,
        timezones: v.timezones
          .split(/[\n,]/)
          .map((t) => t.trim())
          .filter(Boolean),
        tax: v.tax,
        postalCode: { ...v.postalCode, length: v.postalCode.length ? Number(v.postalCode.length) : null },
      });
      toast.success(`${country.name} updated`);
      onSaved();
    } catch (err) {
      setError(apiError(err).message);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {error && <ErrorAlert title="Could not save" message={error} onClose={() => setError('')} />}
      <p className="text-sm text-muted-foreground">
        A company that picks {country.name} starts with these values. It can still change them in its own settings.
      </p>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Localisation</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Currency code" error={errors.currency?.message}>
            <Input {...register('currency')} className="uppercase" placeholder="INR" />
          </Field>
          <Field label="Currency symbol" error={errors.currencySymbol?.message}>
            <Input {...register('currencySymbol')} placeholder="₹" />
          </Field>
          <Field label="Phone code" error={errors.phoneCode?.message}>
            <Input {...register('phoneCode')} placeholder="+91" />
          </Field>
          <Field label="Time zones" hint="One per line, first is the default" className="sm:col-span-3">
            <textarea
              {...register('timezones')}
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-ring"
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Tax</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Tax regime" error={errors.tax?.regime?.message}>
            <Select {...register('tax.regime')}>
              {REGIMES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tax label" hint="Shown on documents, e.g. GST, VAT" error={errors.tax?.label?.message}>
            <Input {...register('tax.label')} />
          </Field>
          <Field label="Tax ID label" hint="e.g. GSTIN, TRN" error={errors.tax?.taxIdLabel?.message}>
            <Input {...register('tax.taxIdLabel')} />
          </Field>
          <Field label="Default rate (%)" error={errors.tax?.defaultRate?.message}>
            <Input type="number" step="0.01" min="0" max="100" {...register('tax.defaultRate')} disabled={regime === 'NONE'} />
          </Field>
          <Field label="Maximum rate (%)" error={errors.tax?.maxRate?.message}>
            <Input type="number" step="0.01" min="0" max="100" {...register('tax.maxRate')} disabled={regime === 'NONE'} />
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox
              label="Split same-state tax"
              description="Same state: CGST + SGST. Different state: IGST."
              {...register('tax.splitIntraState')}
              disabled={regime === 'NONE'}
            />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">Postal code</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Label" error={errors.postalCode?.label?.message}>
            <Input {...register('postalCode.label')} placeholder="PIN code" />
          </Field>
          <Field label="Exact length" hint="Leave blank for any length" error={errors.postalCode?.length?.message}>
            <Input inputMode="numeric" {...register('postalCode.length')} placeholder="6" />
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox label="Digits only" {...register('postalCode.numeric')} />
          </div>
          <Field
            label="Custom pattern (regex)"
            hint="Optional. Overrides length and digits-only, e.g. ^[A-Z]{1,2}\d"
            error={errors.postalCode?.pattern?.message}
            className="sm:col-span-3"
          >
            <Input {...register('postalCode.pattern')} className="font-mono text-xs" />
          </Field>
        </div>
      </section>

      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="outline" disabled={!isDirty || isSubmitting} onClick={() => reset(toForm(country))}>
          Discard
        </Button>
        <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
          <Save className="h-4 w-4" /> Save defaults
        </Button>
      </div>
    </form>
  );
}

/** Searchable list with an inline "add" row and per-row active toggles. */
function MasterList({ title, rows, loading, selected, onSelect, onToggle, addFields, onAdd, emptyLabel, actions }) {
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState({});
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? rows.filter((r) => `${r.name} ${r.code || ''}`.toLowerCase().includes(term)) : rows;
  }, [rows, q]);

  const submit = async (e) => {
    e.preventDefault();
    if (addFields.some((f) => !String(draft[f.key] || '').trim())) return;
    const ok = await onAdd(draft);
    if (ok) setDraft({});
  };

  return (
    <div className="flex min-h-0 flex-col rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground">({rows.length})</span>
        </p>
        {actions}
      </div>
      <div className="border-b p-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${title.toLowerCase()}`} className="h-9" />
      </div>
      <div className="max-h-80 min-h-[8rem] overflow-y-auto">
        {loading ? (
          <LoadingState label="Loading…" />
        ) : filtered.length ? (
          filtered.map((r) => (
            <div
              key={r.id}
              className={cn(
                'flex items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0',
                onSelect && 'cursor-pointer hover:bg-accent/50',
                selected === (r.code || r.id) && 'bg-accent'
              )}
              onClick={() => onSelect?.(r)}
            >
              <span className={cn('flex-1 truncate', !r.isActive && 'text-muted-foreground line-through')}>{r.name}</span>
              {r.code && <span className="font-mono text-xs text-muted-foreground">{r.code}</span>}
              <input
                type="checkbox"
                checked={r.isActive}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggle(r)}
                aria-label={`${r.isActive ? 'Disable' : 'Enable'} ${r.name}`}
                title={r.isActive ? 'Active' : 'Disabled'}
                className="h-4 w-4 accent-primary"
              />
            </div>
          ))
        ) : (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>
        )}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t p-2">
        {addFields.map((f) => (
          <Input
            key={f.key}
            value={draft[f.key] || ''}
            onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
            placeholder={f.placeholder}
            className={cn('h-9', f.className)}
          />
        ))}
        <Button type="submit" size="sm" variant="outline">
          <Plus className="h-4 w-4" /> Add
        </Button>
      </form>
    </div>
  );
}

function StatesAndCities({ country }) {
  const queryClient = useQueryClient();
  const [stateCode, setStateCode] = useState(null);
  useEffect(() => setStateCode(null), [country.code]);

  const states = useQuery({
    queryKey: ['platform', 'locations', 'states', country.code],
    queryFn: async () => (await api.get(`${BASE}/${country.code}/states`, { params: { all: true } })).data?.data || [],
  });
  const cities = useQuery({
    queryKey: ['platform', 'locations', 'cities', country.code, stateCode],
    queryFn: async () =>
      (await api.get(`${BASE}/${country.code}/states/${stateCode}/cities`, { params: { all: true } })).data?.data || [],
    enabled: Boolean(stateCode),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['platform', 'locations'] });
    queryClient.invalidateQueries({ queryKey: ['locations'] });
  };

  const run = async (fn, message) => {
    try {
      await fn();
      if (message) toast.success(message);
      refresh();
      return true;
    } catch (err) {
      toast.error(apiError(err).message);
      return false;
    }
  };

  const importCities = useMutation({
    mutationFn: () => api.post(`${BASE}/${country.code}/import-cities`),
    onSuccess: (res) => {
      toast.success(res.data?.message || 'Cities imported');
      refresh();
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const selectedState = (states.data || []).find((s) => s.code === stateCode);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <MasterList
        title="States"
        rows={states.data || []}
        loading={states.isLoading}
        selected={stateCode}
        onSelect={(s) => setStateCode(s.code)}
        onToggle={(s) => run(() => api.patch(`${BASE}/${country.code}/states/${s.id}`, { isActive: !s.isActive }))}
        addFields={[
          { key: 'code', placeholder: 'Code', className: 'w-24 uppercase' },
          { key: 'name', placeholder: 'State name', className: 'flex-1' },
        ]}
        onAdd={(d) => run(() => api.post(`${BASE}/${country.code}/states`, d), 'State added')}
        emptyLabel="No states yet."
      />
      <MasterList
        title={selectedState ? `Cities in ${selectedState.name}` : 'Cities'}
        rows={stateCode ? cities.data || [] : []}
        loading={Boolean(stateCode) && cities.isLoading}
        onToggle={(c) => run(() => api.patch(`${BASE}/${country.code}/cities/${c.id}`, { isActive: !c.isActive }))}
        addFields={[{ key: 'name', placeholder: stateCode ? 'City name' : 'Select a state first', className: 'flex-1' }]}
        onAdd={(d) =>
          stateCode
            ? run(() => api.post(`${BASE}/${country.code}/states/${stateCode}/cities`, d), 'City added')
            : Promise.resolve(false)
        }
        emptyLabel={stateCode ? 'No cities for this state yet.' : 'Select a state to see its cities.'}
        actions={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={importCities.isPending}
            onClick={() => importCities.mutate()}
            title="Load this country's cities from the bundled dataset (keeps existing ones)"
          >
            <Download className="h-4 w-4" /> Import cities
          </Button>
        }
      />
    </div>
  );
}

export default function Locations() {
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [code, setCode] = useState('IN');
  const [tab, setTab] = useState('defaults');

  const { data = [], isLoading, isError, error } = useQuery({
    queryKey: ['platform', 'locations', 'countries'],
    queryFn: async () => (await api.get(BASE, { params: { all: true, counts: true } })).data?.data || [],
  });

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? data.filter((c) => `${c.name} ${c.code} ${c.currency}`.toLowerCase().includes(term)) : data;
  }, [data, q]);
  const country = data.find((c) => c.code === code) || null;

  const toggleCountry = useMutation({
    mutationFn: () => api.patch(`${BASE}/${country.code}`, { isActive: !country.isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['platform', 'locations'] });
      queryClient.invalidateQueries({ queryKey: ['locations'] });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Locations"
        description="Countries, states and cities used by every address, plus each country's currency, tax and postal code defaults"
        breadcrumbs={[{ label: 'Platform', to: '/platform' }, { label: 'Locations' }]}
      />

      {isError ? (
        <ErrorAlert title="Could not load locations" message={apiError(error).message} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <Card className="flex flex-col overflow-hidden lg:max-h-[calc(100dvh-12rem)]">
            <div className="border-b p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search countries" className="pl-9" />
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto lg:max-h-none lg:flex-1">
              {isLoading ? (
                <LoadingState label="Loading countries…" />
              ) : (
                filtered.map((c) => (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => setCode(c.code)}
                    className={cn(
                      'flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-accent/50 focus-ring',
                      c.code === code && 'bg-accent'
                    )}
                  >
                    <span className="text-base leading-none">{c.flag}</span>
                    <span className={cn('flex-1 truncate', !c.isActive && 'text-muted-foreground line-through')}>{c.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{c.code}</span>
                  </button>
                ))
              )}
            </div>
          </Card>

          {country ? (
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <span className="text-xl">{country.flag}</span> {country.name}
                      <Badge tone={country.isActive ? 'success' : 'muted'} dot>
                        {country.isActive ? 'Active' : 'Disabled'}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      {country.code} · {country.currency || 'no currency'} · {country.tax?.label || 'Tax'}{' '}
                      {country.tax?.regime !== 'NONE' ? `${country.tax?.defaultRate ?? 0}%` : '(none)'} ·{' '}
                      {country.stateCount} states · {country.cityCount} cities
                    </CardDescription>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    loading={toggleCountry.isPending}
                    onClick={() => toggleCountry.mutate()}
                  >
                    {country.isActive ? 'Disable country' : 'Enable country'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <Tabs
                  size="sm"
                  value={tab}
                  onChange={setTab}
                  items={[
                    { value: 'defaults', label: 'Defaults' },
                    { value: 'states', label: 'States & cities' },
                  ]}
                />
                {tab === 'defaults' ? (
                  <CountryDefaults
                    country={country}
                    onSaved={() => queryClient.invalidateQueries({ queryKey: ['platform', 'locations', 'countries'] })}
                  />
                ) : (
                  <StatesAndCities country={country} />
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent>
                <EmptyState title="Select a country" description="Pick a country to edit its defaults, states and cities." />
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
