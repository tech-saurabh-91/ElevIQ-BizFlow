import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { ArrowLeft, Building2, CreditCard, ShieldCheck, UserCog, Copy } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AddressFields } from '@/components/company/form-utils';
import { Input, Select, Textarea, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ErrorAlert } from '@/components/ui/alert';
import { Dialog } from '@/components/ui/dialog';
import { formatMoney, formatDate } from '@/utils/format';

const PASSWORD_RULES = z
  .string()
  .min(8, 'At least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Must contain a lowercase letter')
  .regex(/[A-Z]/, 'Must contain an uppercase letter')
  .regex(/[0-9]/, 'Must contain a number')
  .regex(/[^A-Za-z0-9]/, 'Must contain a symbol');

/** Mirrors the server's createCompanySchema (client-side first line of defence). */
const schema = z
  .object({
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

    planId: z.string().optional().or(z.literal('')),
    startMode: z.enum(['TRIAL', 'PAID', 'CUSTOM']),
    trialDays: z.coerce.number().int().min(0, 'Cannot be negative').max(120, 'Max 120 days').optional(),
    billingCycle: z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY', 'ONCE']).optional(),
    startDate: z.string().optional().or(z.literal('')),
    endDate: z.string().optional().or(z.literal('')),

    adminName: z.string().trim().min(2, 'Admin name is required').max(120),
    adminEmail: z.string().trim().email('A valid admin email is required'),
    adminPhone: z
      .string()
      .trim()
      .regex(/^[+0-9()\-\s]{6,20}$/, 'Enter a valid phone number')
      .optional()
      .or(z.literal('')),
    adminPassword: PASSWORD_RULES,
    adminTitle: z.string().trim().max(80).optional().or(z.literal('')),
  })
  .refine((v) => v.startMode !== 'CUSTOM' || (v.startDate && v.endDate), {
    message: 'Custom plans need both a start and end date',
    path: ['endDate'],
  })
  .refine((v) => !v.startDate || !v.endDate || new Date(v.endDate) > new Date(v.startDate), {
    message: 'End date must be after the start date',
    path: ['endDate'],
  });

const DEFAULTS = {
  businessName: '',
  legalName: '',
  code: '',
  slug: '',
  businessType: 'BOTH',
  email: '',
  phone: '',
  website: '',
  gstin: '',
  pan: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  country: 'India',
  pincode: '',
  planId: '',
  startMode: 'TRIAL',
  trialDays: 14,
  billingCycle: 'YEARLY',
  startDate: '',
  endDate: '',
  adminName: '',
  adminEmail: '',
  adminPhone: '',
  adminPassword: 'ChangeMe#123',
  adminTitle: '',
};

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

export default function CompanyCreate() {
  const navigate = useNavigate();
  const [serverErrors, setServerErrors] = useState([]); // [{field, message}]
  const [formError, setFormError] = useState('');
  const [created, setCreated] = useState(null); // { company, admin, plan }

  const { data: plansData } = useQuery({
    queryKey: ['platform', 'plans', 'options'],
    queryFn: async () => {
      const res = await api.get('/platform/plans', { params: { active: 'true', limit: 100 } });
      return res.data;
    },
  });
  const plans = plansData?.data || [];

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: DEFAULTS });

  const startMode = watch('startMode');
  const selectedPlan = plans.find((p) => p.id === watch('planId'));

  const mutation = useMutation({
    mutationFn: async (values) => {
      const address = {
        line1: values.line1,
        line2: values.line2,
        city: values.city,
        state: values.state,
        country: values.country,
        pincode: values.pincode,
      };
      const payload = {
        businessName: values.businessName,
        legalName: values.legalName,
        code: values.code,
        slug: values.slug,
        businessType: values.businessType,
        email: values.email,
        phone: values.phone,
        website: values.website,
        gstin: values.gstin,
        pan: values.pan,
        address,
        planId: values.planId,
        startMode: values.startMode,
        trialDays: values.startMode === 'TRIAL' ? values.trialDays : undefined,
        billingCycle: values.startMode === 'TRIAL' ? undefined : values.billingCycle,
        startDate: values.startMode === 'CUSTOM' ? values.startDate : undefined,
        endDate: values.startMode === 'CUSTOM' ? values.endDate : undefined,
        admin: {
          name: values.adminName,
          email: values.adminEmail,
          phone: values.adminPhone,
          password: values.adminPassword,
          title: values.adminTitle,
        },
      };
      const res = await api.post('/platform/companies', payload);
      return res.data.data;
    },
    onSuccess: (data) => {
      toast.success(`${data.company.name} provisioned`);
      setCreated(data);
    },
    onError: (err) => {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([f, msg]) => {
        const map = {
          'admin.name': 'adminName',
          'admin.email': 'adminEmail',
          'admin.phone': 'adminPhone',
          'admin.password': 'adminPassword',
          'admin.title': 'adminTitle',
        };
        setError(map[f] || f, { type: 'server', message: msg });
      });
    },
  });

  const onSubmit = (values) => {
    setFormError('');
    setServerErrors(null);
    mutation.mutate(values);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Provision a new company"
        description="Creates the tenant, its settings, first administrator and subscription in one step"
        breadcrumbs={[{ label: 'Companies', to: '/platform/companies' }, { label: 'New company' }]}
        actions={
          <Link to="/platform/companies">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to list
            </Button>
          </Link>
        }
      />

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        {(formError || serverErrors.length > 0) && (
          <ErrorAlert
            title="The company could not be created"
            message={formError}
            errors={serverErrors.filter((e) => !e.field || e.field === '_')}
            onClose={() => {
              setFormError('');
              setServerErrors([]);
            }}
          />
        )}

        <Section icon={Building2} title="Business details" description="Identity of the tenant account">
          <Field label="Business name" required error={errors.businessName?.message}>
            <Input {...register('businessName')} error={!!errors.businessName} placeholder="Acme Distributors Pvt Ltd" />
          </Field>
          <Field label="Legal name" error={errors.legalName?.message}>
            <Input {...register('legalName')} error={!!errors.legalName} placeholder="Acme Distributors Private Limited" />
          </Field>
          <Field
            label="Company code"
            error={errors.code?.message}
            hint="Leave blank to auto-generate from the business name"
          >
            <Input {...register('code')} error={!!errors.code} placeholder="ACME01" className="uppercase" />
          </Field>
          <Field label="URL slug" error={errors.slug?.message} hint="Used in emails and reports. Auto-generated when blank">
            <Input {...register('slug')} error={!!errors.slug} placeholder="acme-distributors" className="lowercase" />
          </Field>
          <Field label="Business type" required error={errors.businessType?.message}>
            <Select {...register('businessType')} error={!!errors.businessType}>
              <option value="BOTH">Retail + Wholesale</option>
              <option value="RETAIL">Retail</option>
              <option value="WHOLESALE">Wholesale</option>
            </Select>
          </Field>
          <Field label="Company email" error={errors.email?.message}>
            <Input type="email" {...register('email')} error={!!errors.email} placeholder="hello@acme.test" />
          </Field>
          <Field label="Company phone" error={errors.phone?.message}>
            <Input {...register('phone')} error={!!errors.phone} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Website" error={errors.website?.message}>
            <Input {...register('website')} error={!!errors.website} placeholder="https://acme.test" />
          </Field>
          <Field label="GSTIN" error={errors.gstin?.message}>
            <Input {...register('gstin')} error={!!errors.gstin} placeholder="27AAAAA0000A1Z5" className="uppercase" />
          </Field>
          <Field label="PAN" error={errors.pan?.message}>
            <Input {...register('pan')} error={!!errors.pan} placeholder="AAAAA0000A" className="uppercase" />
          </Field>
        </Section>

        <Section icon={Building2} title="Registered address" description="Billing and dispatch address">
          <AddressFields register={register} watch={watch} setValue={setValue} errors={errors} prefix="" />
        </Section>

        <Section icon={CreditCard} title="Plan & billing" description="How this tenant is provisioned">
          <Field label="Plan" error={errors.planId?.message}>
            <Select {...register('planId')} error={!!errors.planId}>
              <option value="">No plan yet (trial defaults apply)</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {formatMoney(p.price, p.currency)}/{String(p.billingCycle).toLowerCase()} · {p.maxUsers} users
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start mode" required error={errors.startMode?.message}>
            <Select {...register('startMode')} error={!!errors.startMode}>
              <option value="TRIAL">Free trial</option>
              <option value="PAID">Paid (starts today)</option>
              <option value="CUSTOM">Custom billing window</option>
            </Select>
          </Field>

          {startMode === 'TRIAL' && (
            <Field
              label="Trial length (days)"
              error={errors.trialDays?.message}
              hint={selectedPlan ? `Plan default: ${selectedPlan.trialDays} days` : '0-120 days'}
            >
              <Input type="number" min={0} max={120} {...register('trialDays')} error={!!errors.trialDays} />
            </Field>
          )}

          {startMode === 'PAID' && (
            <Field label="Billing cycle" required error={errors.billingCycle?.message}>
              <Select {...register('billingCycle')} error={!!errors.billingCycle}>
                <option value="MONTHLY">Monthly</option>
                <option value="QUARTERLY">Quarterly</option>
                <option value="YEARLY">Yearly</option>
                <option value="ONCE">One-time</option>
              </Select>
            </Field>
          )}

          {startMode === 'CUSTOM' && (
            <>
              <Field label="Start date" required error={errors.startDate?.message}>
                <Input type="date" {...register('startDate')} error={!!errors.startDate} />
              </Field>
              <Field label="End date" required error={errors.endDate?.message}>
                <Input type="date" {...register('endDate')} error={!!errors.endDate} />
              </Field>
            </>
          )}
        </Section>

        <Section icon={UserCog} title="First administrator" description="This account owns the new workspace">
          <Field label="Admin name" required error={errors.adminName?.message}>
            <Input {...register('adminName')} error={!!errors.adminName} placeholder="Priya Sharma" />
          </Field>
          <Field label="Admin email" required error={errors.adminEmail?.message} hint="Used to sign in to the workspace">
            <Input type="email" {...register('adminEmail')} error={!!errors.adminEmail} placeholder="priya@acme.test" />
          </Field>
          <Field label="Admin phone" error={errors.adminPhone?.message}>
            <Input {...register('adminPhone')} error={!!errors.adminPhone} placeholder="+91 98765 43211" />
          </Field>
          <Field label="Designation" error={errors.adminTitle?.message}>
            <Input {...register('adminTitle')} error={!!errors.adminTitle} placeholder="Sales Head" />
          </Field>
          <Field
            label="Initial password"
            required
            error={errors.adminPassword?.message}
            hint="8+ chars with upper, lower, number and symbol. The admin must change it at first login."
            className="sm:col-span-2"
          >
            <Input {...register('adminPassword')} error={!!errors.adminPassword} />
          </Field>
        </Section>

        <div className="flex items-center justify-end gap-3">
          <Link to="/platform/companies">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
          <Button type="submit" loading={mutation.isLoading || isSubmitting}>
            <ShieldCheck className="mr-2 h-4 w-4" />
            Provision company
          </Button>
        </div>
      </form>

      {/* Success summary */}
      <Dialog
        open={!!created}
        onClose={() => {
          const id = created?.company?.id;
          setCreated(null);
          if (id) navigate(`/platform/companies/${id}`);
        }}
        title="Company provisioned"
        description={`${created?.company?.name || ''} is ready. Share the credentials below with the administrator.`}
        size="md"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                const id = created?.company?.id;
                setCreated(null);
                if (id) navigate(`/platform/companies/${id}`);
              }}
            >
              View 360°
            </Button>
            <Button
              onClick={() => {
                const id = created?.company?.id;
                setCreated(null);
                navigate('/platform/companies');
              }}
            >
              Back to companies
            </Button>
          </>
        }
      >
        {created && (
          <div className="space-y-4 text-sm">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
              <dt className="text-muted-foreground">Code</dt>
              <dd className="flex items-center gap-2 font-medium">
                {created.company.code}
                <Badge tone="info">{created.company.status}</Badge>
              </dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="font-mono">{created.company.slug}</dd>
              <dt className="text-muted-foreground">Admin sign-in</dt>
              <dd className="font-medium">{created.admin?.email}</dd>
              <dt className="text-muted-foreground">Initial password</dt>
              <dd className="flex items-center gap-2 font-mono">
                {created.admin?.password}
                <button
                  type="button"
                  className="text-primary hover:underline focus-ring rounded"
                  onClick={() => {
                    navigator.clipboard?.writeText(created.admin?.password || '');
                    toast.success('Password copied');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </dd>
              <dt className="text-muted-foreground">Subscription ends</dt>
              <dd>{created.company.subscriptionEnd ? formatDate(created.company.subscriptionEnd) : '—'}</dd>
            </dl>
            <p className="rounded-md bg-warning/10 px-3 py-2 text-xs text-warning-foreground dark:text-warning">
              The administrator must change this password at first sign-in. It is shown only once.
            </p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
