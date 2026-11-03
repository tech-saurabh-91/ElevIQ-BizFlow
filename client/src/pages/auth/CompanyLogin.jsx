import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, LogIn, Building2 } from 'lucide-react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import toast from 'react-hot-toast';

import { useAuth } from '@/hooks/useAuth';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';
import { toFieldErrors } from '@/api/client';

const schema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or phone'),
  password: z.string().min(1, 'Password is required'),
});

export default function CompanyLogin() {
  const { loginAsCompany } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState(null);
  // Set when the same login + password exists in several companies.
  const [workspaces, setWorkspaces] = useState(null);

  const {
    register,
    handleSubmit,
    getValues,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '' },
  });

  const signIn = async (values, companyCode) => {
    setServerError(null);
    const res = await loginAsCompany({
      identifier: values.identifier,
      password: values.password,
      companyCode,
    });

    if (res.ok) {
      const name = res.data?.company?.name || 'your workspace';
      toast.success(`Welcome back to ${name}`);
      const from = location.state?.from || '/app';
      navigate(from, { replace: true });
    } else {
      if (res.error?.errors?.length) {
        Object.entries(toFieldErrors(res.error.errors)).forEach(([f, m]) => setError(f, { message: m }));
      }
      if (res.error?.code === 'MULTIPLE_ACCOUNTS' && Array.isArray(res.error.details)) {
        setWorkspaces(res.error.details);
        return;
      }
      setWorkspaces(null);
      setServerError(res.error);
    }
  };

  const onSubmit = (values) => signIn(values);

  return (
    <div>
      <div className="mb-7">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" /> Company Workspace
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Sign in to your workspace</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Orders, invoicing, collections and field-force tracking for your business.
        </p>
      </div>

      {serverError && (
        <div className="mb-5">
          <ErrorAlert
            title={
              {
                COMPANY_SUSPENDED: 'Company suspended',
                COMPANY_EXPIRED: 'Subscription expired',
                ACCOUNT_LOCKED: 'Account locked',
              }[serverError.code] || 'Sign in failed'
            }
            message={serverError.message}
            errors={serverError.errors}
            onClose={() => setServerError(null)}
          />
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label required htmlFor="identifier">
            Email or phone
          </Label>
          <Input
            id="identifier"
            autoComplete="username"
            placeholder="you@company.com or +91XXXXXXXXXX"
            error={errors.identifier?.message}
            {...register('identifier')}
          />
          {errors.identifier && (
            <p className="text-xs font-medium text-destructive">{errors.identifier.message}</p>
          )}
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

        <div className="flex items-center justify-between">
          <Link
            to="/forgot-password"
            className="text-xs font-medium text-brand-600 hover:underline focus-ring rounded"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          <LogIn className="h-4 w-4" /> Sign in
        </Button>
      </form>

      {workspaces && (
        <div className="mt-5 space-y-2 rounded-lg border p-3.5">
          <p className="text-sm font-medium">This login belongs to more than one company. Choose one:</p>
          {workspaces.map((w) => (
            <Button
              key={w.code}
              type="button"
              variant="outline"
              className="w-full justify-start"
              disabled={isSubmitting}
              onClick={() => signIn(getValues(), w.code)}
            >
              <Building2 className="h-4 w-4" /> {w.name}
            </Button>
          ))}
        </div>
      )}

      <div className="mt-6 flex items-center justify-between rounded-lg border bg-muted/40 p-3.5 text-xs text-muted-foreground">
        <span>
          Platform owner?{' '}
          <Link to="/platform/login" className="font-medium text-brand-600 hover:underline">
            Service Provider Console
          </Link>
        </span>
        <span className="font-semibold text-foreground">ElevIQ SFA</span>
      </div>
    </div>
  );
}
