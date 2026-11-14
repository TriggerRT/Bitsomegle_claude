import type { SessionEndReason } from '@bitsomeggle/shared';
import type { ChatState } from '../state/chatMachine.ts';
import { ChatPanel } from './ChatPanel.tsx';

const END_TEXT: Record<SessionEndReason, string> = {
  partner_next: 'Stranger moved on.',
  partner_left: 'Stranger left.',
  partner_disconnected: 'Stranger disconnected.',
};

interface ConversationProps {
  state: ChatState;
  onNext: () => void;
  onLeave: () => void;
  onSend: (text: string) => void;
}

/** The chat screen. Also shown, read-only, after the partner has left. */
export function Conversation({ state, onNext, onLeave, onSend }: ConversationProps) {
  const active = state.phase === 'in_session';

  return (
    <main className="screen conversation">
      <header className="toolbar">
        <p className="status-line" role="status">
          {active
            ? "You're chatting with a stranger."
            : `${state.endReason ? END_TEXT[state.endReason] : 'The chat ended.'} Press Next to meet someone new.`}
        </p>
        <div className="actions">
          <button type="button" className="secondary" onClick={onLeave}>
            Leave
          </button>
          <button type="button" className="primary" onClick={onNext}>
            Next
          </button>
        </div>
      </header>

      {/* The video area is added here in Milestone M4. */}
      <ChatPanel messages={state.messages} canSend={active} onSend={onSend} />
    </main>
  );
}
