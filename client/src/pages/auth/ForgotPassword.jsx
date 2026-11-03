import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Building2, KeyRound, MailCheck } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';

import api, { apiError } from '@/api/client';
import { Input, Label } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ErrorAlert } from '@/components/ui/alert';

const schema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
});

/**
 * Step 1 of password recovery: request a reset link.
 * The response is always the same generic message (no account enumeration),
 * so the UI mirrors that wording.
 */
export default function ForgotPassword() {
  const [searchParams] = useSearchParams();
  const scope = searchParams.get('scope') === 'platform' ? 'platform' : 'company';
  const isPlatform = scope === 'platform';

  const [serverError, setServerError] = useState(null);
  const [sent, setSent] = useState(null); // { email, devToken? }

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      const res = await api.post('/auth/forgot-password', { email: values.email, scope });
      setSent({ email: values.email, devToken: res.data?.data?.devToken });
    } catch (err) {
      setServerError(apiError(err));
    }
  };

  const backTo = isPlatform ? '/platform/login' : '/login';

  if (sent) {
    const resetHref = sent.devToken
      ? `/reset-password?token=${encodeURIComponent(sent.devToken)}&scope=${scope}`
      : null;

    return (
      <div>
        <div className="mb-7">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Building2 className="h-3.5 w-3.5" /> {isPlatform ? 'Service Provider Console' : 'Company Workspace'}
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Check your inbox</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            If an account exists for <span className="font-medium text-foreground">{sent.email}</span>, a reset
            link has been sent. The link expires in 30 minutes.
          </p>
        </div>

        <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          <div className="flex items-start gap-2.5">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
            <span>
              Didn&apos;t get the email? Check your spam folder, or contact your workspace administrator to
              reset the password for you.
            </span>
          </div>
        </div>

        {/* Dev/QA convenience: without SMTP_URL the API echoes the token so the
            flow can be completed locally. Never shown in production. */}
        {resetHref && (
          <div className="mt-4 rounded-lg border border-dashed bg-muted/30 p-4">
            <p className="text-xs font-medium text-muted-foreground">
              Development mode — SMTP is not configured, so open the link directly:
            </p>
            <Link to={resetHref} className="mt-2 inline-block text-sm font-semibold text-brand-600 hover:underline">
              Open reset link →
            </Link>
          </div>
        )}

        <div className="mt-6">
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:underline focus-ring rounded"
          >
            <ArrowLeft className="h-4 w-4" /> Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-7">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border bg-muted/60 px-3 py-1 text-xs font-medium text-muted-foreground">
          <Building2 className="h-3.5 w-3.5" /> {isPlatform ? 'Service Provider Console' : 'Company Workspace'}
        </div>
        <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Enter the email you sign in with and we&apos;ll send you a link to set a new password.
        </p>
      </div>

      {serverError && (
        <div className="mb-5">
          <ErrorAlert
            title="Could not send reset link"
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
            autoComplete="email"
            placeholder="you@company.com"
            error={errors.email?.message}
            {...register('email')}
          />
          {errors.email && <p className="text-xs font-medium text-destructive">{errors.email.message}</p>}
        </div>

        <Button type="submit" className="w-full" size="lg" loading={isSubmitting}>
          <KeyRound className="h-4 w-4" /> Send reset link
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-between rounded-lg border bg-muted/40 p-3.5 text-xs text-muted-foreground">
        <span>
          Remembered it?{' '}
          <Link to={backTo} className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </span>
        <span className="font-semibold text-foreground">ElevIQ SFA</span>
      </div>
    </div>
  );
}
