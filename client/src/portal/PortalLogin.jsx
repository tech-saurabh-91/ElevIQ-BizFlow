import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { ErrorAlert, Alert, AlertDescription } from '@/components/ui/alert';
import { LoadingState } from '@/components/ui/misc';
import { apiError } from '@/api/client';
import portalApi from './portalApi';
import { usePortalStore } from './portalStore';
import { portalPath, usePortalCode } from './portal-shared';

const TITLES = {
  ACCOUNT_LOCKED: 'Too many wrong PINs',
  PORTAL_DISABLED: 'Online ordering is off',
  PORTAL_ACCESS_OFF: 'Online ordering is off for your shop',
  COMPANY_SUSPENDED: 'Not available right now',
  COMPANY_EXPIRED: 'Not available right now',
};

/** Customer sign-in on the company's own link: mobile + PIN. */
export default function PortalLogin() {
  const code = usePortalCode();
  const navigate = useNavigate();
  const location = useLocation();
  const session = usePortalStore((s) => s.session);
  const token = usePortalStore((s) => s.accessToken);
  const [mobile, setMobile] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const info = useQuery({
    queryKey: ['portal', 'company', code],
    queryFn: async () => (await portalApi.get(`/company/${code}`)).data.data,
    retry: false,
  });

  useEffect(() => {
    if (info.data?.name) document.title = `${info.data.name} · Sign in`;
  }, [info.data?.name]);

  if (token && session?.company?.code === code) return <Navigate to={portalPath(code)} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await portalApi.post('/auth/login', { companyCode: code, mobile, pin });
      usePortalStore.getState().setSession(data.data);
      const from = location.state?.from;
      navigate(from && from.startsWith(portalPath(code)) ? from : portalPath(code), { replace: true });
    } catch (err) {
      setError(apiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10">
      <div className="w-full max-w-sm">
        {info.isLoading ? (
          <LoadingState />
        ) : info.isError ? (
          <ErrorAlert title="This ordering link is not valid" message="Please check the link the company sent you." />
        ) : (
          <div className="rounded-2xl border bg-card p-6 shadow-sm">
            <div className="mb-6 flex flex-col items-center text-center">
              {info.data.logo ? (
                <img src={info.data.logo} alt="" className="mb-3 h-14 w-14 rounded-xl object-contain" />
              ) : (
                <span className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-500/15 text-lg font-bold text-brand-600">
                  {info.data.name.slice(0, 2).toUpperCase()}
                </span>
              )}
              <h1 className="text-lg font-semibold">{info.data.name}</h1>
              <p className="text-sm text-muted-foreground">Order online</p>
            </div>

            {!info.data.open ? (
              <Alert tone="warning">
                <AlertDescription>Online ordering is not open right now. Please contact the company.</AlertDescription>
              </Alert>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <Field label="Mobile number">
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      inputMode="tel"
                      autoComplete="tel"
                      className="pl-9"
                      placeholder="10-digit mobile"
                      required
                    />
                  </div>
                </Field>
                <Field label="PIN">
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      inputMode="numeric"
                      type="password"
                      autoComplete="current-password"
                      className="pl-9 tracking-widest"
                      placeholder="4 to 6 digits"
                      required
                    />
                  </div>
                </Field>
                {error && <ErrorAlert title={TITLES[error.code] || 'Could not sign in'} message={error.message} />}
                <Button type="submit" className="w-full" loading={busy} disabled={!mobile || pin.length < 4}>
                  Sign in
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  Forgot your PIN? Ask your salesman or the company for a new one.
                </p>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
