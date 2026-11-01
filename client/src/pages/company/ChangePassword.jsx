import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { KeyRound, Eye, EyeOff, ShieldCheck } from 'lucide-react';

import api, { apiError, toFieldErrors } from '@/api/client';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, ErrorAlert } from '@/components/ui/alert';
import { useAuth } from '@/hooks/useAuth';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'At least 8 characters')
      .max(128)
      .regex(/[a-z]/, 'Include a lowercase letter')
      .regex(/[A-Z]/, 'Include an uppercase letter')
      .regex(/[0-9]/, 'Include a number')
      .regex(/[^A-Za-z0-9]/, 'Include a symbol'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

const policy = [
  'At least 8 characters',
  'One uppercase and one lowercase letter',
  'At least one number',
  'At least one symbol (e.g. !@#$)',
];

export default function ChangePassword() {
  const { user, clear } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState({ current: false, next: false });
  const [serverError, setServerError] = useState(null);
  const [mustChange] = useState(Boolean(user?.mustChangePassword));

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  });

  const newPassword = watch('newPassword', '');

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await api.post('/auth/change-password', {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success('Password updated — please sign in again');
      clear();
      navigate('/login', { replace: true });
    } catch (err) {
      const e = apiError(err);
      if (e.errors?.length) {
        Object.entries(toFieldErrors(e.errors)).forEach(([f, m]) => setError(f, { message: m }));
      }
      setServerError(e);
    }
  };

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Change password"
        description="Update the password for your ElevIQ SFA account."
        breadcrumbs={[{ label: 'Workspace', to: '/app' }, { label: 'Change password' }]}
      />

      {mustChange && (
        <div className="mb-5">
          <Alert tone="warning">
            <p className="font-medium">Password change required</p>
            <p className="text-sm opacity-90">
              Your administrator issued a temporary password. Set a new one to continue using the
              workspace.
            </p>
          </Alert>
        </div>
      )}

      {serverError && (
        <div className="mb-5">
          <ErrorAlert
            title="Could not update password"
            message={serverError.message}
            errors={serverError.errors}
            onClose={() => setServerError(null)}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-muted-foreground" /> Set a new password
          </CardTitle>
          <CardDescription>
            Changing your password signs you out of every other device for safety.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label required>Current password</Label>
              <div className="relative">
                <Input
                  type={show.current ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="pr-10"
                  error={errors.currentPassword?.message}
                  {...register('currentPassword')}
                />
                <ToggleEye
                  open={show.current}
                  onClick={() => setShow((s) => ({ ...s, current: !s.current }))}
                />
              </div>
              {errors.currentPassword && (
                <p className="text-xs font-medium text-destructive">{errors.currentPassword.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label required>New password</Label>
              <div className="relative">
                <Input
                  type={show.next ? 'text' : 'password'}
                  autoComplete="new-password"
                  className="pr-10"
                  error={errors.newPassword?.message}
                  {...register('newPassword')}
                />
                <ToggleEye
                  open={show.next}
                  onClick={() => setShow((s) => ({ ...s, next: !s.next }))}
                />
              </div>
              {errors.newPassword && (
                <p className="text-xs font-medium text-destructive">{errors.newPassword.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label required>Confirm new password</Label>
              <Input
                type="password"
                autoComplete="new-password"
                error={errors.confirmPassword?.message}
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <p className="text-xs font-medium text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>

            {/* Live policy checklist */}
            <ul className="grid gap-1.5 rounded-lg border bg-muted/40 p-3.5 text-xs">
              {policy.map((p, i) => {
                const ok = [
                  newPassword.length >= 8,
                  /[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword),
                  /[0-9]/.test(newPassword),
                  /[^A-Za-z0-9]/.test(newPassword),
                ][i];
                return (
                  <li key={p} className={`flex items-center gap-2 ${ok ? 'text-success' : 'text-muted-foreground'}`}>
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border text-[8px]">
                      {ok ? '✓' : ''}
                    </span>
                    {p}
                  </li>
                );
              })}
            </ul>

            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                <ShieldCheck className="h-4 w-4" /> Update password
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const ToggleEye = ({ open, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground focus-ring"
    aria-label={open ? 'Hide password' : 'Show password'}
  >
    {open ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
  </button>
);
