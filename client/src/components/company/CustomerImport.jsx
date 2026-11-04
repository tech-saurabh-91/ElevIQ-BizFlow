import BulkImport from '@/components/company/BulkImport';

/** Customer bulk import (Excel template with dropdowns for the masters). */
export default function CustomerImport({ open, onClose }) {
  return (
    <BulkImport
      open={open}
      onClose={onClose}
      endpoint="/v1/customers"
      noun="customers"
      invalidate={[['company', 'customers']]}
      hint="Dropdowns list your types, countries, states, price lists and salesmen."
    />
  );
}
