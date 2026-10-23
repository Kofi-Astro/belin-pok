// Deleting a record outright -- owner only. Everyday mistakes are fixed in
// ways that keep the history (voiding a sale, a stock correction); this is
// for records that should never have existed, like a sale rung up while
// trying the till out. The API undoes what the record did (stock back,
// credit charges off) and the activity log keeps a line saying who deleted
// what and why -- see services/api/app/erase.py.
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/lib/auth";

import { Modal, useToast } from "./overlay";
import { Button, Field, FormError, IconButton, Input } from "./ui";

/** The confirmation: what's being deleted, what will happen, and a
 * required reason (it goes in the activity log). onDelete does the API
 * call with the reason; an error (e.g. "they've already paid towards
 * this") is shown in the dialog. */
export function DeleteRecordDialog({
  open,
  onClose,
  title,
  description,
  consequences,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  consequences: React.ReactNode;
  onDelete: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setReason("");
    setError(null);
    onClose();
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete(reason.trim());
      setReason("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="danger" icon={Trash2} disabled={reason.trim().length < 3} loading={busy} onClick={() => void submit()}>
            Delete permanently
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <FormError message={error} />
        <div className="text-ink/80">{consequences}</div>
        <p className="text-xs text-muted">This can&apos;t be undone. The activity log keeps a note that it was deleted, by you, and why.</p>
        <Field label="Why delete it?">
          <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Test entry while trying out the app" />
        </Field>
      </div>
    </Modal>
  );
}

/** A trash button that opens DeleteRecordDialog -- rendered only for owners,
 * so nobody else sees an option they can't use. `run` performs the delete
 * with the reason. Afterwards everything cached is refreshed -- a deletion
 * changes stock, totals, balances and lists all over the app. `done` runs
 * first (e.g. leaving the page of the record that no longer exists, so it
 * isn't refetched into a "not found"). */
export function OwnerDeleteButton({
  label,
  title,
  description,
  consequences,
  run,
  done,
  compact = false,
}: {
  label: string;
  title: string;
  description?: React.ReactNode;
  consequences: React.ReactNode;
  run: (reason: string) => Promise<unknown>;
  done?: () => unknown;
  compact?: boolean;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  if (!can.isOwner) return null;
  return (
    <>
      {compact ? (
        <IconButton icon={Trash2} label={label} onClick={() => setOpen(true)} className="hover:text-red-600" />
      ) : (
        <Button size="sm" variant="ghost" icon={Trash2} className="text-red-600" onClick={() => setOpen(true)}>
          {label}
        </Button>
      )}
      <DeleteRecordDialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        consequences={consequences}
        onDelete={async (reason) => {
          await run(reason);
          toast.success("Deleted");
          await done?.();
          await qc.invalidateQueries();
        }}
      />
    </>
  );
}
