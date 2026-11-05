import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { describeError } from "../hermes/gateway-error";

interface ModalDialogProps {
  title: string;
  /** The button that does the work, and what it says while that runs. */
  action: { label: string; busyLabel: string; enabled: boolean; danger?: boolean };
  /** Does the work. Its error shows in the dialog after `failure`, and the dialog stays open. */
  perform: () => Promise<void>;
  failure: string;
  /** Called once the work is done, or when the dialog is cancelled. */
  onClose: () => void;
  children: ReactNode;
}

/** A modal dialog with Cancel and one action. It keeps focus inside itself and closes on Esc. */
export function ModalDialog({ title, action, perform, failure, onClose, children }: ModalDialogProps) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !action.enabled) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await perform();
      onClose();
    } catch (error) {
      setProblem(`${failure} ${describeError(error)}`);
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        // Nothing closes it while the work runs.
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col sm:max-w-md" showCloseButton={!busy}>
        <form className="flex min-h-0 flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {/* What's inside can't be changed while the work runs. */}
          <div className="flex min-h-0 flex-col gap-3" inert={busy}>
            {children}
          </div>
          {problem && (
            <p className="text-sm text-destructive" role="alert">
              {problem}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" variant={action.danger ? "destructive" : "default"} disabled={busy || !action.enabled}>
              {busy ? action.busyLabel : action.label}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
