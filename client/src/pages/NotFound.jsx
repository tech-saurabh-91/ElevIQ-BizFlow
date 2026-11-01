import { MapPinOff, ArrowLeft, Home } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/brand/Logo';

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-5 text-center">
      <Logo className="mb-10" size="md" />
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
        <MapPinOff className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">404</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        The page you are looking for doesn’t exist or may have been moved.
      </p>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <Link
          to="/"
          className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-ring"
        >
          <Home className="h-4 w-4" /> Go home
        </Link>
      </div>
    </div>
  );
}
