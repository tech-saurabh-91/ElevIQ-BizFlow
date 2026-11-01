import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand/Logo';
import { useAuth } from '@/hooks/useAuth';

export default function Forbidden() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const home = user?.scope === 'platform' ? '/platform' : '/app';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 text-center">
      <Logo className="mb-10" size="md" />
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
        <ShieldAlert className="h-8 w-8 text-destructive" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">403</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Access denied</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        You don’t have permission to view this page. If you believe this is a mistake, contact
        your company administrator.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Button onClick={() => navigate(home)}>Go to dashboard</Button>
      </div>
    </div>
  );
}
