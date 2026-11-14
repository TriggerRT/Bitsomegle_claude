interface WaitingProps {
  onCancel: () => void;
}

export function Waiting({ onCancel }: WaitingProps) {
  return (
    <main className="screen waiting">
      <div className="spinner" aria-hidden="true" />
      <p className="status-line" role="status">
        Looking for someone…
      </p>
      <button type="button" className="secondary" onClick={onCancel}>
        Cancel
      </button>
    </main>
  );
}
