import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Power, UserCog, UserRoundCheck, UserRoundX, Users as UsersIcon } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import ResourcePage from '@/components/company/ResourcePage';
import { FormActions, FormSection, opt } from '@/components/company/form-utils';
import { Input, Select, Field } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { ErrorAlert } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';
import { useLookups } from '@/hooks/useLookups';
import { usePermissions } from '@/hooks/usePermissions';
import { formatDate, timeAgo } from '@/utils/format';
import { SALES_TYPES, salesTypeLabel } from '@/utils/salesType';

const ROLES = ['COMPANY_ADMIN', 'MANAGER', 'SALESMAN', 'ACCOUNTANT', 'WAREHOUSE'];
const ROLE_LABEL = {
  COMPANY_ADMIN: 'Company admin',
  MANAGER: 'Manager',
  SALESMAN: 'Salesman',
  ACCOUNTANT: 'Accountant',
  WAREHOUSE: 'Warehouse',
};
const ROLE_TONE = {
  COMPANY_ADMIN: 'default',
  MANAGER: 'info',
  SALESMAN: 'success',
  ACCOUNTANT: 'warning',
  WAREHOUSE: 'secondary',
};

const PASSWORD_MESSAGE =
  'Use 8+ characters with an uppercase letter, a lowercase letter, a number and a symbol.';

const strongPassword = (value) =>
  value.length >= 8 &&
  value.length <= 128 &&
  /[a-z]/.test(value) &&
  /[A-Z]/.test(value) &&
  /[0-9]/.test(value) &&
  /[^A-Za-z0-9]/.test(value);

const text = (max = 200) => z.string().trim().max(max).optional().or(z.literal(''));
const optionalEmail = z.string().trim().email('Enter a valid email').optional().or(z.literal(''));
const optionalPhone = z
  .string()
  .trim()
  .regex(/^[+0-9()\-\s]{6,20}$/, 'Enter a valid phone number')
  .optional()
  .or(z.literal(''));

const schema = z
  .object({
    name: z.string().trim().min(2, 'Name is required').max(120),
    email: optionalEmail,
    phone: optionalPhone,
    role: z.enum(ROLES),
    salesType: z.enum(['PRESALE', 'VAN_SALE', 'BOTH']),
    password: z.string().optional().or(z.literal('')),
    title: text(80),
    employeeCode: text(30),
    designation: text(80),
    territory: text(80),
    reportingManager: text(40),
    warehouse: text(40),
    routes: z.array(z.string()),
    isActive: z.boolean(),
    mustChangePassword: z.boolean(),
  })
  .refine((v) => Boolean(v.email) || Boolean(v.phone), {
    message: 'Enter an email or a phone number',
    path: ['email'],
  })
  .refine((v) => !v.password || strongPassword(v.password), {
    message: PASSWORD_MESSAGE,
    path: ['password'],
  });

const toDefaults = (initial) => ({
  name: initial?.name || '',
  email: initial?.email || '',
  phone: initial?.phone || '',
  role: initial?.role || 'SALESMAN',
  salesType: initial?.salesType || 'PRESALE',
  password: '',
  title: initial?.title || '',
  employeeCode: initial?.employeeCode || '',
  designation: initial?.designation || '',
  territory: initial?.territory || '',
  reportingManager: initial?.reportingManager?.id || initial?.reportingManager || '',
  warehouse: initial?.warehouse?.id || initial?.warehouse || '',
  routes: (initial?.routes || []).map((r) => r.id || r._id || r),
  isActive: initial?.isActive ?? true,
  mustChangePassword: initial?.mustChangePassword ?? false,
});

function UserForm({ mode, initial, onClose, onSaved }) {
  const [formError, setFormError] = useState('');
  const [serverErrors, setServerErrors] = useState([]);
  const { lookups } = useLookups();

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: toDefaults(initial) });

  const onSubmit = async (values) => {
    setFormError('');
    setServerErrors([]);

    const payload = {
      name: values.name,
      email: values.email || '',
      phone: values.phone || '',
      role: values.role,
      salesType: values.salesType,
      title: values.title,
      employeeCode: values.employeeCode,
      designation: values.designation,
      territory: values.territory,
      reportingManager: opt(values.reportingManager),
      warehouse: opt(values.warehouse),
      routes: values.routes,
      isActive: values.isActive,
      mustChangePassword: values.mustChangePassword,
    };
    if (mode === 'create' && values.password) payload.password = values.password;

    try {
      const res =
        mode === 'create'
          ? await api.post('/v1/users', payload)
          : await api.patch(`/v1/users/${initial.id}`, payload);
      toast.success(mode === 'create' ? 'User created' : 'User updated');
      onSaved(res.data?.data, mode);
    } catch (err) {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([field, message]) => {
        setError(field, { type: 'server', message });
      });
    }
  };

  const colleagueOptions = lookups.users.filter((u) => u.id !== initial?.id);
  const role = watch('role');
  const salesType = watch('salesType');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
      {(formError || serverErrors.length > 0) && (
        <ErrorAlert
          title="Could not save the user"
          message={formError}
          errors={serverErrors.filter((e) => !e.field || e.field === '_')}
          onClose={() => {
            setFormError('');
            setServerErrors([]);
          }}
        />
      )}

      <FormSection title="Profile">
        <Field label="Full name" required error={errors.name?.message}>
          <Input {...register('name')} error={!!errors.name} placeholder="Anita Deshmukh" />
        </Field>
        <Field label="Role" required error={errors.role?.message}>
          <Select {...register('role')}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        {role === 'SALESMAN' && (
          <Field
            label="Sales type"
            required
            error={errors.salesType?.message}
            hint={SALES_TYPES.find((t) => t.value === salesType)?.hint}
          >
            <Select {...register('salesType')} aria-label="Sales type">
              {SALES_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Email" error={errors.email?.message} hint="Email or phone is required">
          <Input type="email" {...register('email')} error={!!errors.email} placeholder="anita@company.test" />
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          <Input {...register('phone')} placeholder="+91 98765 43210" />
        </Field>
        <Field label="Designation" error={errors.designation?.message}>
          <Input {...register('designation')} placeholder="Territory Sales Officer" />
        </Field>
        <Field label="Employee code" error={errors.employeeCode?.message}>
          <Input {...register('employeeCode')} placeholder="EMP-014" />
        </Field>
        <Field label="Job title" error={errors.title?.message}>
          <Input {...register('title')} placeholder="Key accounts" />
        </Field>
        <Field label="Territory" error={errors.territory?.message}>
          <Input {...register('territory')} placeholder="Pune East" />
        </Field>
        {mode === 'create' && (
          <Field
            label="Initial password"
            error={errors.password?.message}
            hint={`Leave blank to generate a temporary password automatically. ${PASSWORD_MESSAGE}`}
            className="sm:col-span-2"
          >
            <Input
              type="password"
              {...register('password')}
              error={!!errors.password}
              placeholder="Optional"
              autoComplete="new-password"
            />
          </Field>
        )}
      </FormSection>

      <FormSection title="Reporting & territory">
        <Field label="Reporting manager" error={errors.reportingManager?.message}>
          <Select {...register('reportingManager')}>
            <option value="">No manager</option>
            {colleagueOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.role.replace(/_/g, ' ')}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Warehouse" error={errors.warehouse?.message}>
          <Select {...register('warehouse')}>
            <option value="">No warehouse</option>
            {lookups.warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} ({w.code})
              </option>
            ))}
          </Select>
        </Field>
      </FormSection>

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold">Assigned routes</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Salesmen only see customers on routes assigned to them.
          </p>
        </div>
        {lookups.routes.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            No routes yet — create routes from the Routes &amp; Beats page.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {lookups.routes.map((route) => (
              <label
                key={route.id}
                className="flex cursor-pointer select-none items-start gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-primary/5"
              >
                <input
                  type="checkbox"
                  value={route.id}
                  className="mt-0.5 h-4 w-4 rounded border-input accent-primary"
                  {...register('routes')}
                />
                <span>
                  <span className="font-medium">{route.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {route.code}
                    {route.territory ? ` · ${route.territory}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>

      <FormSection title="Account">
        <Checkbox
          label="Active account"
          description="Deactivating a user revokes their sessions immediately."
          {...register('isActive')}
        />
        <Checkbox
          label="Require password change at next sign-in"
          description="The user must set a new password on their next sign-in."
          {...register('mustChangePassword')}
        />
      </FormSection>

      <FormActions
        onCancel={onClose}
        loading={isSubmitting}
        submitLabel={mode === 'create' ? 'Create user' : 'Save changes'}
      />
    </form>
  );
}

const resetSchema = z
  .object({
    newPassword: z.string().refine(strongPassword, PASSWORD_MESSAGE),
    confirmPassword: z.string(),
    mustChangePassword: z.boolean(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

function ResetPasswordDialog({ target, onClose }) {
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(resetSchema),
    defaultValues: { newPassword: '', confirmPassword: '', mustChangePassword: true },
  });

  const onSubmit = async (values) => {
    setFormError('');
    try {
      await api.post(`/v1/users/${target.id}/reset-password`, {
        newPassword: values.newPassword,
        mustChangePassword: values.mustChangePassword,
      });
      toast.success(`Password reset for ${target.name}`);
      queryClient.invalidateQueries({ queryKey: ['company', 'users'] });
      onClose();
    } catch (err) {
      setFormError(apiError(err).message);
    }
  };

  return (
    <Dialog
      open={Boolean(target)}
      onClose={onClose}
      title={`Reset password — ${target?.name || ''}`}
      description="All of this user's sessions will be revoked immediately."
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        {formError && <ErrorAlert title="Could not reset the password" message={formError} onClose={() => setFormError('')} />}
        <Field label="New password" required error={errors.newPassword?.message} hint={PASSWORD_MESSAGE}>
          <Input
            type="password"
            {...register('newPassword')}
            error={!!errors.newPassword}
            autoComplete="new-password"
          />
        </Field>
        <Field label="Confirm password" required error={errors.confirmPassword?.message}>
          <Input
            type="password"
            {...register('confirmPassword')}
            error={!!errors.confirmPassword}
            autoComplete="new-password"
          />
        </Field>
        <Checkbox
          label="Require change at next sign-in"
          description="Recommended when sharing the password over chat or email."
          {...register('mustChangePassword')}
        />
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" loading={isSubmitting}>
            Reset password
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function StatCard({ label, value, icon: Icon, tone }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-2.5 p-3.5 sm:gap-3 sm:p-6 sm:py-4">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10 ${tone}`}>
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground sm:text-xs">{label}</p>
          <p className="text-lg font-semibold leading-tight sm:text-xl">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const { can, isAdmin } = usePermissions();
  const queryClient = useQueryClient();
  const [temp, setTemp] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);

  const { data: statsData } = useQuery({
    queryKey: ['company', 'users', 'stats'],
    queryFn: async () => {
      const res = await api.get('/v1/users/stats');
      return res.data?.data || {};
    },
  });

  const toggleActive = useMutation({
    mutationFn: (row) => api.patch(`/v1/users/${row.id}`, { isActive: !row.isActive }),
    onSuccess: (_res, row) => {
      toast.success(row.isActive ? 'User deactivated' : 'User activated');
      queryClient.invalidateQueries({ queryKey: ['company', 'users'] });
    },
    onError: (err) => toast.error(apiError(err).message),
  });

  const stats = statsData || {};

  const header = (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <StatCard
        label="Total users"
        value={stats.total ?? '—'}
        icon={UsersIcon}
        tone="bg-brand-500/12 text-brand-600 dark:text-brand-300"
      />
      <StatCard label="Active" value={stats.active ?? '—'} icon={UserRoundCheck} tone="bg-success/12 text-success" />
      <StatCard label="Inactive" value={stats.inactive ?? '—'} icon={UserRoundX} tone="bg-muted text-muted-foreground" />
      <StatCard
        label="Plan limit"
        value={stats.limit ? `${stats.total ?? 0} / ${stats.limit}` : 'Unlimited'}
        icon={UserCog}
        tone="bg-warning/15 text-warning"
      />
    </div>
  );

  const columns = [
    {
      key: 'name',
      header: 'User',
      sortable: 'name',
      render: (row) => (
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-xs font-bold text-brand-600 dark:text-brand-300">
            {(row.name || '?')
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">
              {row.name}
              {row.id === currentUser?.id && <span className="ml-1.5 text-xs text-muted-foreground">(you)</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{row.email || row.phone || '—'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      sortable: 'role',
      render: (row) => (
        <div className="space-y-1">
          <Badge tone={ROLE_TONE[row.role] || 'secondary'}>{ROLE_LABEL[row.role] || row.role}</Badge>
          <p className="text-xs text-muted-foreground">
            {row.role === 'SALESMAN' ? `${salesTypeLabel(row.salesType || 'BOTH')} · ` : ''}
            {row.designation || row.title || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'manager',
      header: 'Reports to',
      render: (row) => (
        <div className="text-sm">
          <p>{row.reportingManager?.name || '—'}</p>
          <p className="text-xs text-muted-foreground">{row.territory || 'No territory'}</p>
        </div>
      ),
    },
    {
      key: 'lastLogin',
      header: 'Last login',
      sortable: 'lastLoginAt',
      render: (row) =>
        row.lastLoginAt ? (
          <div className="text-sm">
            <p>{timeAgo(row.lastLoginAt)}</p>
            <p className="text-xs text-muted-foreground">{formatDate(row.lastLoginAt)}</p>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Never</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <Badge tone={row.isActive ? 'success' : 'muted'}>{row.isActive ? 'Active' : 'Inactive'}</Badge>
      ),
    },
  ];

  const filters = ({ values, setParam }) => (
    <>
      <Select
        aria-label="Filter by role"
        className="h-9 w-auto min-w-[10rem]"
        value={values.role || ''}
        onChange={(e) => setParam({ role: e.target.value || undefined, page: 1 })}
      >
        <option value="">All roles</option>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Filter by status"
        className="h-9 w-auto min-w-[8rem]"
        value={values.isActive || ''}
        onChange={(e) => setParam({ isActive: e.target.value || undefined, page: 1 })}
      >
        <option value="">All statuses</option>
        <option value="true">Active</option>
        <option value="false">Inactive</option>
      </Select>
    </>
  );

  const canUpdate = isAdmin || can('users.update');
  const canDelete = isAdmin || can('users.delete');

  return (
    <>
      <ResourcePage
        title="Users & Teams"
        description="Workspace members, roles, reporting lines and route assignments"
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Users & Teams' }]}
        queryKey={['company', 'users']}
        endpoint="/v1/users"
        permissionPrefix="users"
        columns={columns}
        filterKeys={['role', 'isActive']}
        filters={filters}
        searchPlaceholder="Search by name, email, phone, code or territory…"
        createLabel="Add user"
        createIcon={UserCog}
        emptyTitle="No users yet"
        emptyDescription="Invite your sales team, managers and accountants."
        formTitle={(mode) => (mode === 'create' ? 'Add user' : 'Edit user')}
        formDescription="Roles control the permission matrix configured in Company Settings."
        formSize="xl"
        header={header}
        renderForm={(props) => <UserForm {...props} />}
        onSaved={(saved, mode) => {
          if (mode === 'create' && saved?.temporaryPassword) {
            setTemp({ name: saved.name, password: saved.temporaryPassword });
          }
        }}
        rowActions={(row, { close }) => {
          if (row.id === currentUser?.id) return null;
          return (
            <>
              {canUpdate && (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent focus-ring"
                  onClick={() => {
                    close();
                    setResetTarget(row);
                  }}
                >
                  <KeyRound className="h-4 w-4" /> Reset password
                </button>
              )}
              {canUpdate && (
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm hover:bg-accent focus-ring"
                  onClick={() => {
                    close();
                    toggleActive.mutate(row);
                  }}
                >
                  <Power className="h-4 w-4" /> {row.isActive ? 'Deactivate' : 'Activate'}
                </button>
              )}
            </>
          );
        }}
        canCreate={isAdmin || can('users.create')}
        canEdit={canUpdate}
        canDelete={canDelete}
        deleteMessage={(row) =>
          row
            ? `“${row.name}” will be removed and their sessions revoked. Customers and routes assigned to them will be unassigned.`
            : ''
        }
      />

      <Dialog
        open={Boolean(temp)}
        onClose={() => setTemp(null)}
        title="Temporary password"
        description="Copy this password now — it will not be shown again."
        size="sm"
      >
        {temp && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">User</p>
              <p className="font-medium">{temp.name}</p>
              <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">Password</p>
              <p className="break-all font-mono text-lg font-semibold">{temp.password}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(temp.password);
                    toast.success('Password copied');
                  } catch {
                    toast.error('Could not copy — select the password manually');
                  }
                }}
              >
                <Copy className="h-4 w-4" /> Copy
              </Button>
              <Button type="button" onClick={() => setTemp(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      <ResetPasswordDialog target={resetTarget} onClose={() => setResetTarget(null)} />
    </>
  );
}
