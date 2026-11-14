import { CHAT_MESSAGE_MAX_LENGTH } from '@bitsomeggle/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import type { ChatMessage } from '../state/chatMachine.ts';

interface ChatPanelProps {
  messages: ChatMessage[];
  /** False once the partner has left: the conversation stays readable but is closed. */
  canSend: boolean;
  onSend: (text: string) => void;
}

export function ChatPanel({ messages, canSend, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const endOfListRef = useRef<HTMLLIElement>(null);
  const messageCount = messages.length;

  // Keep the newest message in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run when a message is added
  useEffect(() => {
    endOfListRef.current?.scrollIntoView({ block: 'end' });
  }, [messageCount]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!canSend || draft.trim() === '') return;
    onSend(draft);
    setDraft('');
  };

  return (
    <section className="chat-panel" aria-label="Text chat">
      <ol className="messages" aria-live="polite">
        {messages.length === 0 && <li className="empty">Say hi 👋</li>}
        {messages.map((message) => (
          <li key={message.id} className={`message ${message.from}`}>
            <span className="author">{message.from === 'me' ? 'You' : 'Stranger'}</span>
            <span className="text">{message.text}</span>
            {message.delivery === 'failed' && <span className="failed">Not delivered</span>}
          </li>
        ))}
        <li ref={endOfListRef} aria-hidden="true" />
      </ol>

      <form className="composer" onSubmit={submit}>
        <input
          type="text"
          aria-label="Message"
          placeholder={canSend ? 'Type a message' : 'This chat has ended'}
          value={draft}
          maxLength={CHAT_MESSAGE_MAX_LENGTH}
          disabled={!canSend}
          autoComplete="off"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="primary" disabled={!canSend || draft.trim() === ''}>
          Send
        </button>
      </form>
    </section>
  );
}
