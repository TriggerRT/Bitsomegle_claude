import { REPORT_REASONS, type ReportReason } from '@bitsomeggle/shared';
import { useEffect, useRef } from 'react';

const REASON_LABEL: Record<ReportReason, string> = {
  inappropriate: 'Nudity or sexual content',
  harassment: 'Harassment or hate',
  spam: 'Spam or advertising',
  other: 'Something else',
};

interface ReportDialogProps {
  open: boolean;
  onReport: (reason: ReportReason) => void;
  onCancel: () => void;
}

/**
 * Asks why the person is being reported. A step between pressing Report and sending it,
 * so nobody reports someone by a slip of the finger.
 *
 * Uses the browser's own <dialog>: it keeps keyboard focus inside while open, closes on
 * Escape and gives focus back to the Report button afterwards.
 */
export function ReportDialog({ open, onReport, onCancel }: ReportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby="report-title"
      // Escape: keep our own state in charge of whether the dialog is open.
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id="report-title">Report this person?</h2>
      <p>They won't be told, and you won't be matched with them again.</p>
      <div className="dialog-options">
        {REPORT_REASONS.map((reason) => (
          <button key={reason} type="button" className="secondary" onClick={() => onReport(reason)}>
            {REASON_LABEL[reason]}
          </button>
        ))}
      </div>
      <button type="button" className="link" onClick={onCancel}>
        Cancel
      </button>
    </dialog>
  );
}
