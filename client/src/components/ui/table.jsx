import * as React from 'react';
import { cn } from '@/utils/cn';

/**
 * `cards`: on phones every row becomes a card (see .table-cards in index.css):
 * the first cell is the card's title, the others show "Header ... value" and
 * the row menu cell (`data-actions`) is pinned top-right. A table straight
 * inside a .card shows separate cards; one nested deeper shows a plain list.
 */
export const Table = React.forwardRef(({ className, cards = false, ...props }, ref) => {
  return (
    <div className="relative w-full overflow-auto">
      <table
        ref={ref}
        className={cn('w-full caption-bottom border-collapse text-sm', cards && 'table-cards', className)}
        {...props}
      />
    </div>
  );
});
Table.displayName = 'Table';

export const TableHeader = React.forwardRef(({ className, ...props }, ref) => (
  <thead ref={ref} className={cn('sticky top-0 z-10 bg-muted/60 backdrop-blur', className)} {...props} />
));
TableHeader.displayName = 'TableHeader';

export const TableBody = React.forwardRef(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('divide-y divide-border', className)} {...props} />
));
TableBody.displayName = 'TableBody';

export const TableFooter = React.forwardRef(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn('border-t bg-muted/40 font-medium', className)} {...props} />
));
TableFooter.displayName = 'TableFooter';

export const TableRow = React.forwardRef(({ className, ...props }, ref) => (
  <tr
    ref={ref}
    className={cn('border-b transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted', className)}
    {...props}
  />
));
TableRow.displayName = 'TableRow';

export const TableHead = React.forwardRef(({ className, sortable = false, children, ...props }, ref) => (
  <th
    ref={ref}
    scope="col"
    className={cn('th', sortable && 'cursor-pointer select-none hover:text-foreground', className)}
    {...props}
  >
    {children}
  </th>
));
TableHead.displayName = 'TableHead';

export const TableCell = React.forwardRef(({ className, ...props }, ref) => (
  <td ref={ref} className={cn('td', className)} {...props} />
));
TableCell.displayName = 'TableCell';

export const TableCaption = React.forwardRef(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export default Table;
