import { Construction, ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * Friendly placeholder shown for modules that ship in a later phase.
 * Keeps navigation testable while clearly communicating the roadmap.
 */
export default function Placeholder({ title = 'Coming soon', phase = '?', description }) {
  const navigate = useNavigate();
  return (
    <div>
      <PageHeader
        title={title}
        description={description || 'This module is part of a planned build phase.'}
        actions={
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        }
      />
      <Card>
        <CardContent className="flex flex-col items-center justify-center px-6 py-16 text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-warning/15">
            <Construction className="h-8 w-8 text-warning" aria-hidden="true" />
          </div>
          <div className="mb-2">
            <Badge tone="warning">Phase {phase}</Badge>
          </div>
          <h2 className="text-lg font-semibold">{title} — under construction</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            This screen is scheduled for <strong>Phase {phase}</strong> of the ElevIQ SFA build
            plan. The backend contracts and navigation are already wired, so it will light up as
            soon as the module ships.
          </p>
          <div className="mt-6">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" /> Go back
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
