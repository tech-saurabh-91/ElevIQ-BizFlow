import { useState } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';

/** Cancel a posted document, with an optional reason. */
export function CancelDialog({ open, title, message, onClose, onConfirm, loading }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason)} loading={loading}>
            Cancel it
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {message && <p className="text-sm text-muted-foreground">{message}</p>}
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
        </Field>
      </div>
    </Dialog>
  );
}

export default CancelDialog;
