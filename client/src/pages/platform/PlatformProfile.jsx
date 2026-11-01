import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { UserRound, Mail, ShieldCheck, Phone, Save, KeyRound, Building2 } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input, Field } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar } from '@/components/ui/avatar';
import { ErrorAlert } from '@/components/ui/alert';
import { Dialog } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/useAuth';
import { useAuthStore } from '@/store/authStore';
import { formatDateTime } from '@/utils/format';

const schema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^[+0-9()\-\s]{6,20}$/, 'Enter a valid phone number')
    .optional()
    .or(z.literal('')),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .max(128)
      .regex(/[a-z]/, 'Must contain a lowercase letter')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[0-9]/, 'Must contain a number')
      .regex(/[^A-Za-z0-9]/, 'Must contain a symbol'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

export default function PlatformProfile() {
  const queryClient = useQueryClient();
  const { user, impersonation } = useAuth();
  const [serverErrors, setServerErrors] = useState([]);
  const [formError, setFormError] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (user) reset({ name: user.name || '', phone: user.phone || '' });
  }, [user, reset]);

  const mutation = useMutation({
    mutationFn: async (v) => {
      const res = await api.patch('/platform/profile', { name: v.name, phone: v.phone });
      return res.data.data;
    },
    onSuccess: (data) => {
      toast.success('Profile updated');
      setFormError('');
      setServerErrors([]);
      // Keep the topbar identity in sync.
      if (data?.user) {
        useAuthStore.setState({
          user: { ...useAuthStore.getState().user, name: data.user.name, phone: data.user.phone },
        });
      }
      queryClient.invalidateQueries({ queryKey: ['platform', 'profile'] });
    },
    onError: (err) => {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setServerErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([f, msg]) => setError(f, { type: 'server', message: msg }));
    },
  });

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="My profile" description="Your service provider account on ElevIQ SFA" />

      <Card>
        <CardContent className="flex items-center gap-4 py-6">
          <Avatar name={user?.name || 'Admin'} src={user?.avatar} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{user?.name}</h2>
              <Badge tone={user?.role === 'SUPER_ADMIN' ? 'info' : 'secondary'}>
                <ShieldCheck className="h-3 w-3" />
                {String(user?.role || '').replace(/_/g, ' ')}
              </Badge>
            </div>
            <p className="truncate text-sm text-muted-foreground">{user?.email}</p>
            {user?.lastLoginAt && (
              <p className="mt-0.5 text-xs text-muted-foreground">Last sign-in {formatDateTime(user.lastLoginAt)}</p>
            )}
          </div>
          <Link to="/platform">
            <Button variant="outline" size="sm">
              <Building2 className="mr-1.5 h-4 w-4" />
              Dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account details</CardTitle>
          <CardDescription>Email and role are managed by the platform owner and cannot be edited here.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(mutation.mutate)} className="grid gap-4 sm:grid-cols-2" noValidate>
            {(formError || serverErrors.length > 0) && (
              <div className="sm:col-span-2">
                <ErrorAlert
                  title="Your profile could not be updated"
                  message={formError}
                  errors={serverErrors.filter((e) => !e.field || e.field === '_')}
                  onClose={() => {
                    setFormError('');
                    setServerErrors([]);
                  }}
                />
              </div>
            )}
            <Field label="Full name" required error={errors.name?.message}>
              <Input {...register('name')} error={!!errors.name} />
            </Field>
            <Field label="Phone" error={errors.phone?.message}>
              <Input {...register('phone')} error={!!errors.phone} placeholder="+91 98765 43210" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email" hint="Contact the platform owner to change the sign-in email">
                <Input value={user?.email || ''} disabled icon={Mail} />
              </Field>
            </div>
            <div className="flex justify-end sm:col-span-2">
              <Button type="submit" loading={mutation.isLoading || isSubmitting} disabled={(!isDirty && !mutation.isLoading) || !!impersonation}>
                <Save className="mr-2 h-4 w-4" />
                Save changes
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyRound className="h-4 w-4 text-brand-500" />
            Password
          </CardTitle>
          <CardDescription>Change your sign-in password. You will stay signed in on this device.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setPasswordOpen(true)}>
            <KeyRound className="mr-2 h-4 w-4" />
            Change password
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="py-4 text-xs text-muted-foreground">
          <p className="flex items-center gap-1.5">
            <UserRound className="h-3.5 w-3.5" />
            Account ID {user?.id || user?._id || '—'} · created by the ElevIQ platform team
          </p>
        </CardContent>
      </Card>

      <PasswordDialog open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Change-password dialog (uses /auth/change-password, works for platform scope)
// ---------------------------------------------------------------------------
function PasswordDialog({ open, onClose }) {
  const [formError, setFormError] = useState('');
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(passwordSchema) });

  const mutation = useMutation({
    mutationFn: async (v) => {
      await api.post('/auth/change-password', {
        currentPassword: v.currentPassword,
        newPassword: v.newPassword,
      });
    },
    onSuccess: () => {
      toast.success('Password changed');
      setFormError('');
      reset();
      onClose();
    },
    onError: (err) => {
      const info = apiError(err);
      const fields = toFieldErrors(info.errors);
      setFormError(Object.keys(fields).length ? '' : info.message);
      Object.entries(fields).forEach(([f, msg]) => setError(f, { type: 'server', message: msg }));
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Change password"
      description="Use a strong password you don't reuse anywhere else."
      size="sm"
      dismissible={!mutation.isLoading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mutation.isLoading}>
            Cancel
          </Button>
          <Button loading={mutation.isLoading || isSubmitting} onClick={handleSubmit(mutation.mutate)}>
            <KeyRound className="mr-2 h-4 w-4" />
            Update password
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(mutation.mutate)} className="space-y-4" noValidate>
        {formError && <ErrorAlert title="Could not change the password" message={formError} onClose={() => setFormError('')} />}
        <Field label="Current password" required error={errors.currentPassword?.message}>
          <Input type="password" autoComplete="current-password" {...register('currentPassword')} error={!!errors.currentPassword} />
        </Field>
        <Field label="New password" required error={errors.newPassword?.message} hint="8+ chars with upper, lower, number and symbol">
          <Input type="password" autoComplete="new-password" {...register('newPassword')} error={!!errors.newPassword} />
        </Field>
        <Field label="Confirm new password" required error={errors.confirmPassword?.message}>
          <Input type="password" autoComplete="new-password" {...register('confirmPassword')} error={!!errors.confirmPassword} />
        </Field>
      </form>
    </Dialog>
  );
}
