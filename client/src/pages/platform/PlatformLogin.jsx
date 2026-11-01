import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, ShieldCheck, Lock } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '@/hooks/useAuth';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { toFieldErrors } from '@/api/client';

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export default function PlatformLogin() {
  const { loginAsPlatform } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const onSubmit = async (values) => {
    setServerError(null);
    const res = await loginAsPlatform(values);
    if (res.ok) {
      toast.success('Welcome back, ElevIQ admin');
      const from = location.state?.from || '/platform';
      navigate(from, { replace: true });
    } else {
      if (res.error?.errors?.length) {
        Object.entries(toFieldErrors(res.error.errors)).forEach(([f, m]) => setError(f, { message: m }));
      }
      setServerError(res.error);
    }
  };

  return (
    <div>
      <div className="mb-7">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-600 dark:text-brand-300">
          <ShieldCheck className="h-3.5 w-3.5" /> Service Provider Console
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Platform admin sign in</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Manage companies, plans, subscriptions and revenue for ElevIQ SFA.
        </p>
      </div>

      {serverError && (
        <div className="mb-5">
          <ErrorAlert
            title={serverError.code === 'ACCOUNT_LOCKED' ? 'Account locked' : 'Sign in failed'}
            message={serverError.message}
            errors={serverError.errors}
            onClose={() => setServerError(null)}
          />
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label required htmlFor="email">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="superadmin@eleviqsfa.com"
            error={errors.email?.message}
            {...register('email')}
          />
          {errors.email && <p className="text-xs font-medium text-destructive">{errors.email.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label required htmlFor="password">
            Password
          </Label>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="••••••••"
              className="pr-10"
              error={errors.password?.message}
              {...register('password')}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-muted-foreground hover:text-foreground focus-ring"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {errors.password && <p className="text-xs font-medium text-destructive">{errors.password.message}</p>}
        </div>

        <Button type="submit" className="w-full" loading={isSubmitting}>
          <Lock className="h-4 w-4" /> Sign in to console
        </Button>
      </form>

      <div className="mt-6 rounded-lg border bg-muted/40 p-3.5 text-xs text-muted-foreground">
        <p className="mb-1 font-medium text-foreground">First time here?</p>
        <p>
          Seeded credentials come from your <code className="rounded bg-muted px-1">.env</code> file
          (<code className="rounded bg-muted px-1">SUPER_ADMIN_EMAIL</code> /{' '}
          <code className="rounded bg-muted px-1">SUPER_ADMIN_PASSWORD</code>) via{' '}
          <code className="rounded bg-muted px-1">npm run seed</code>.
        </p>
      </div>
    </div>
  );
}
