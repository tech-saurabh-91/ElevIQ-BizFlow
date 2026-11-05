import { useState, useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { ArrowLeft, Building2, Save, CreditCard } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AddressFields, LocaleFields, checkContact, isIndiaCountry } from '@/components/company/form-utils';
import { useCountries, findCountry } from '@/hooks/useLocations';
import { Input, Select, Field } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorAlert } from '@/components/ui/alert';

const schema = z.object({
  businessName: z.string().trim().min(2, 'Business name is required').max(160),
  legalName: z.string().trim().max(200).optional().or(z.literal('')),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{3,10}$/, '3-10 letters or numbers')
    .optional()
    .or(z.literal('')),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/, '3-60 lowercase characters, no spaces')
    .optional()
    .or(z.literal('')),
  businessType: z.enum(['RETAIL', 'WHOLESALE', 'BOTH']),
  email: z.string().trim().email('A valid email is required').optional().or(z.literal('')),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  website: z.string().trim().max(200).optional().or(z.literal('')),
  gstin: z.string().trim().toUpperCase().max(20).optional().or(z.literal('')),
  pan: z.string().trim().toUpperCase().max(12).optional().or(z.literal('')),
  line1: z.string().trim().max(160).optional().or(z.literal('')),
  line2: z.string().trim().max(160).optional().or(z.literal('')),
  city: z.string().trim().max(80).optional().or(z.literal('')),
  state: z.string().trim().max(80).optional().or(z.literal('')),
  country: z.string().trim().max(80).optional().or(z.literal('')),
  pincode: z.string().trim().max(12).optional().or(z.literal('')),
  currency: z.string().trim().max(8).optional().or(z.literal('')),
  currencySymbol: z.string().trim().max(6).optional().or(z.literal('')),
  timezone: z.string().trim().max(60).optional().or(z.literal('')),
  financialYearStartMonth: z.string().optional().or(z.literal('')),
  graceDays: z.coerce.number().int().min(0, 'Cannot be negative').max(60, 'Max 60 days').optional(),
  userLimit: z.coerce.number().int().min(1, 'At least 1').max(10000).optional(),
}).superRefine((v, ctx) => checkContact(v, ctx, { phone: 'phone', gstin: 'gstin', pan: 'pan' }, isIndiaCountry(v.country)));

function Section({ icon: Icon, title, description, children }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="h-4 w-4 text-brand-500" />}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

export default function CompanyEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serverErrors, setServerErrors] = useState([]);
  const [formError, setFormError] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['platform', 'company', id],
    queryFn: async () => {
      const res = await api.get(`/platform/companies/${id}`);
      return res.data.data;
    },
    enabled: !!id,
  });

  const company = data?.company;

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({ resolver: zodResolver(schema) });

  const { data: countries = [] } = useCountries();
  const editCountry = findCountry(countries, watch('country'));
  const lockedReason = company?.transactions > 0 ? '🔒 Locked: the company already has transactions' : '';

  // Populate the form once the company loads.
  useEffect(() => {
    if (!company) return;
    reset({
      businessName: company.name || '',
      legalName: company.legalName || '',
      code: company.code || '',
      slug: company.slug || '',
      businessType: company.businessType || 'BOTH',
      email: company.email || '',
      phone: company.phone || '',
      website: company.website || '',
      gstin: company.gstin || '',
      pan: company.pan || '',
      line1: company.address?.line1 || '',
      line2: company.address?.line2 || '',
      city: company.address?.city || '',
      state: company.address?.state || '',
      country: company.address?.country || '',
      pincode: company.address?.pincode || '',
      currency: company.currency || '',
      currencySymbol: company.currencySymbol || '',
      timezone: company.timezone || '',
      financialYearStartMonth: String(company.financialYearStartMonth || 4),
      graceDays: company.graceDays ?? 7,
      userLimit: company.userLimit ?? company.limits?.maxUsers ?? 5,
    });
  }, [company, reset]);

  const mutation = useMutation({
    mutationFn: async (v) => {
      const payload = {
        businessName: v.businessName,
        legalName: v.legalName,
        code: v.code,
        slug: v.slug,
        businessType: v.businessType,
        email: v.email,
        phone: v.phone,
        website: v.website,
        gstin: v.gstin,
        pan: v.pan,
        address: { line1: v.line1, line2: v.line2, city: v.city, state: v.state, country: v.country, pincode: v.pincode },
        currency: v.currency,
        currencySymbol: v.currencySymbol,
        timezone: v.timezone,
        financialYearStartMonth: Number(v.financialYearStartMonth),
        graceDays: v.graceDays,
        userLimit: v.userLimit,
      };
      const res = await api.patch(`/platform/companies/${id}`, payload);
      return res.data.data;
    },
    onSuccess: () => {
      toast.success('Company updated');
      queryClient.invalidateQueries({ queryKey: ['platform', 'company', id] });
      queryClient.invalidateQueries({ queryKey: ['platform', 'companies'] });
      navigate(`/platform/companies/${id}`);
    },
    onError: (err) => {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([f, msg]) => setError(f, { type: 'server', message: msg }));
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (isError || !company) {
    return (
      <Card>
        <EmptyState
          icon="error"
          title="Could not load this company"
          description={apiError(error).message}
          action={
            <Link to="/platform/companies">
              <Button variant="outline">Back to companies</Button>
            </Link>
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit ${company.name}`}
        description={`Code ${company.code} · subscription changes are made from the 360° page`}
        breadcrumbs={[
          { label: 'Companies', to: '/platform/companies' },
          { label: company.name, to: `/platform/companies/${id}` },
          { label: 'Edit' },
        ]}
        actions={
          <Link to={`/platform/companies/${id}`}>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to 360°
            </Button>
          </Link>
        }
      />

      <form onSubmit={handleSubmit(mutation.mutate)} className="space-y-6" noValidate>
        {(formError || serverErrors.length > 0) && (
          <ErrorAlert
            title="The company could not be updated"
            message={formError}
            errors={serverErrors.filter((e) => !e.field || e.field === '_')}
            onClose={() => {
              setFormError('');
              setServerErrors([]);
            }}
          />
        )}

        <Section icon={Building2} title="Business details">
          <Field label="Business name" required error={errors.businessName?.message}>
            <Input {...register('businessName')} error={!!errors.businessName} />
          </Field>
          <Field label="Legal name" error={errors.legalName?.message}>
            <Input {...register('legalName')} error={!!errors.legalName} />
          </Field>
          <Field label="Company code" error={errors.code?.message}>
            <Input {...register('code')} error={!!errors.code} className="uppercase" />
          </Field>
          <Field label="URL slug" error={errors.slug?.message}>
            <Input {...register('slug')} error={!!errors.slug} className="lowercase" />
          </Field>
          <Field label="Business type" required error={errors.businessType?.message}>
            <Select {...register('businessType')} error={!!errors.businessType}>
              <option value="BOTH">Retail + Wholesale</option>
              <option value="RETAIL">Retail</option>
              <option value="WHOLESALE">Wholesale</option>
            </Select>
          </Field>
          <Field label="Company email" error={errors.email?.message}>
            <Input type="email" {...register('email')} error={!!errors.email} />
          </Field>
          <Field label="Company phone" error={errors.phone?.message}>
            <Input {...register('phone')} error={!!errors.phone} />
          </Field>
          <Field label="Website" error={errors.website?.message}>
            <Input {...register('website')} error={!!errors.website} />
          </Field>
          <Field label="GSTIN" error={errors.gstin?.message}>
            <Input {...register('gstin')} error={!!errors.gstin} className="uppercase" />
          </Field>
          <Field label="PAN" error={errors.pan?.message}>
            <Input {...register('pan')} error={!!errors.pan} className="uppercase" />
          </Field>
        </Section>

        <Section icon={Building2} title="Registered address">
          <AddressFields
            register={register}
            watch={watch}
            setValue={setValue}
            errors={errors}
            prefix=""
            lockedFields={{ country: lockedReason }}
          />
        </Section>

        <Section
          icon={Building2}
          title="Currency, time zone & financial year"
          description={
            lockedReason
              ? `This company has ${company.transactions} transaction(s): currency, country and financial year are locked. Tax registration number and state can still be corrected here.`
              : 'Editable until the company records its first transaction.'
          }
        >
          <LocaleFields
            register={register}
            watch={watch}
            setValue={setValue}
            errors={errors}
            country={editCountry}
            locked={lockedReason}
          />
        </Section>

        <Section
          icon={CreditCard}
          title="Limits & grace"
          description={`Plan ${company.plan?.name || '—'} · limits are copied from the plan at provisioning; override them here if this tenant needs more`}
        >
          <Field
            label="User limit"
            error={errors.userLimit?.message}
            hint={`Plan default: ${company.limits?.maxUsers ?? 5}`}
          >
            <Input type="number" min={1} {...register('userLimit')} error={!!errors.userLimit} />
          </Field>
          <Field
            label="Grace days after expiry"
            error={errors.graceDays?.message}
            hint="Days a lapsed subscription keeps working before suspension"
          >
            <Input type="number" min={0} max={60} {...register('graceDays')} error={!!errors.graceDays} />
          </Field>
        </Section>

        <div className="flex items-center justify-end gap-3">
          <Link to={`/platform/companies/${id}`}>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
          <Button type="submit" loading={mutation.isLoading || isSubmitting} disabled={!isDirty && !mutation.isLoading}>
            <Save className="mr-2 h-4 w-4" />
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
