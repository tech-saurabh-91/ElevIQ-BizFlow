import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Building2, KeyRound, ShieldAlert } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';

import api, { apiError } from '@/api/client';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';

// Mirrors the server-side policy in authValidators.resetPasswordSchema.
const schema = z
  .object({
    password: z
      .string()
      .min(8, 'At least 8 characters')
      .max(128, 'Too long')
      .regex(/[a-z]/, 'Must contain a lowercase letter')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[0-9]/, 'Must contain a number')
      .regex(/[^A-Za-z0-9]/, 'Must contain a symbol'),
    confirm: z.string().min(1, 'Confirm your new password'),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'],
  });

/** Step 2 of password recovery: choose a new password from the emailed link. */
export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const scope = searchParams.get('scope') === 'platform' ? 'platform' : 'company';
  const isPlatform = scope === 'platform';

  const [serverError, setServerError] = useState(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
  });

  const backTo = isPlatform ? '/platform/login' : '/login';

  if (!token) {
    return (
      <div>
        <div className="mb-7">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" /> {isPlatform ? 'Service Provider Console' : 'Company Workspace'}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Invalid reset link</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This link is missing its token. Request a new one and try again.
          </p>
        </div>
        <Link
          to={isPlatform ? '/platform/login' : '/forgot-password'}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline focus-ring rounded"
        >
          <ArrowLeft className="h-4 w-4" /> {isPlatform ? 'Back to sign in' : 'Request a reset link'}
        </Link>
      </div>
    );
  }

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      await api.post('/auth/reset-password', { token, password: values.password, scope });
      toast.success('Password updated — sign in with your new password');
      navigate(backTo, { replace: true });
    } catch (err) {
      setServerError(apiError(err));
    }
  };

  return (
    <div>
      <div className="mb-7">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" /> {isPlatform ? 'Service Provider Console' : 'Company Workspace'}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Choose a new password</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          The link is valid for 30 minutes and can be used once. All existing sessions will be signed out.
        </p>
      </div>

      {serverError && (
        <div className="mb-5">
          <ErrorAlert
            title={
              serverError.code === 'INVALID_RESET_TOKEN' ? 'Link expired or already used' : 'Reset failed'
            }
            message={serverError.message}
            errors={serverError.errors}
            onClose={() => setServerError(null)}
          />
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label required htmlFor="password">
            New password
          </Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            error={errors.password?.message}
            {...register('password')}
          />
          {errors.password && <p className="text-xs font-medium text-destructive">{errors.password.message}</p>}
          <p className="text-xs text-muted-foreground">
            At least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label required htmlFor="confirm">
            Confirm new password
          </Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            error={errors.confirm?.message}
            {...register('confirm')}
          />
          {errors.confirm && <p className="text-xs font-medium text-destructive">{errors.confirm.message}</p>}
        </div>

        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          <KeyRound className="h-4 w-4" /> Update password
        </Button>
      </form>

      <div className="mt-4 flex items-start gap-2 rounded-lg border bg-muted/40 p-3.5 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Didn&apos;t request this? You can safely ignore it — your current password keeps working until the
          link is used.
        </span>
      </div>
    </div>
  );
}
