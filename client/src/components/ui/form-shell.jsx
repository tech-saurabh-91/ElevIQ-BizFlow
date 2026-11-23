import { ArrowLeft } from 'lucide-react';

import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/utils/cn';

/**
 * A document form or view shown either as a dialog or as a full page (like
 * the order and invoice screens). Same props as Dialog; with `asPage` the
 * title becomes the page header (with breadcrumbs and Back), the body sits in
 * a card using the whole width, and the footer buttons stay in a bar at the
 * bottom of the screen.
 */
export function FormShell({ asPage = false, breadcrumbs, headerActions, children, footer, title, description, onClose, className, ...dialogProps }) {
  if (!asPage) {
    return (
      <Dialog title={title} description={description} footer={footer} onClose={onClose} {...dialogProps}>
        {children}
      </Dialog>
    );
  }
  return (
    <div className={cn('space-y-4', footer && 'pb-4')}>
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={breadcrumbs}
        actions={
          <>
            {headerActions}
            {onClose && (
              <Button variant="outline" onClick={onClose} className="max-sm:hidden">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
            )}
          </>
        }
      />
      <Card>
        <CardContent className={cn('p-4 sm:p-6', className)}>{children}</CardContent>
      </Card>
      {footer && (
        <div className="sticky bottom-0 z-20 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6">
          {footer}
        </div>
      )}
    </div>
  );
}

export default FormShell;
