import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !action.enabled) return;
    setBusy(true);
    setProblem(undefined);
    try {
      await perform();
      dialog.current?.close();
    } catch (error) {
      setProblem(`${failure} ${describeError(error)}`);
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-label={title}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
      onClose={onClose}
    >
      <form className="dialog-form" onSubmit={submit}>
        <h2>{title}</h2>
        {/* What's inside can't be changed while the work runs. */}
        <div className="dialog-body" inert={busy}>
          {children}
        </div>
        {problem && (
          <p className="problem" role="alert">
            {problem}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={() => dialog.current?.close()} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={action.danger ? "danger" : "primary"} disabled={busy || !action.enabled}>
            {busy ? action.busyLabel : action.label}
          </button>
        </div>
      </form>
    </dialog>
  );
}
