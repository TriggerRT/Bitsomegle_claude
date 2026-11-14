import type { SessionEndReason } from '@bitsomeggle/shared';
import type { Chat } from '../hooks/useChat.ts';
import type { ChatState } from '../state/chatMachine.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { MediaControls } from './MediaControls.tsx';
import { VideoTile } from './VideoTile.tsx';

const END_TEXT: Record<SessionEndReason, string> = {
  partner_next: 'Stranger moved on.',
  partner_left: 'Stranger left.',
  partner_disconnected: 'Stranger disconnected.',
};

/** What to show over the partner's video area when there is no picture to see. */
function remoteNotice(state: ChatState): string | null {
  if (state.phase !== 'in_session') {
    const reason = state.endReason ? END_TEXT[state.endReason] : 'The chat ended.';
    return `${reason} Press Next to meet someone new.`;
  }
  if (state.call === 'failed') {
    return "Couldn't connect video. You can still chat by text, or press Next.";
  }
  if (state.call === 'connecting') return 'Connecting video…';
  if (!state.partnerMedia.video) return "Stranger's camera is off.";
  return null;
}

interface ConversationProps {
  chat: Chat;
}

/** The call screen. Also shown, with the chat read-only, after the partner has left. */
export function Conversation({ chat }: ConversationProps) {
  const { state } = chat;
  const active = state.phase === 'in_session';
  const notice = remoteNotice(state);

  return (
    <main className="screen conversation">
      <section className="stage" aria-label="Video">
        <div className="remote">
          {active && (
            <VideoTile
              stream={chat.remoteStream}
              isSelf={false}
              label="Stranger's video"
              testId="remote-video"
            />
          )}
          {notice && (
            <p className="overlay" role="status">
              {notice}
            </p>
          )}
          {active && !state.partnerMedia.audio && <p className="badge">Stranger is muted</p>}

          <div className="self-view">
            <VideoTile stream={chat.localStream} isSelf label="Your video" testId="local-video" />
            {!state.localMedia.video && <p className="overlay small">Your camera is off</p>}
          </div>
        </div>

        <div className="toolbar">
          <p className="status-line">
            {active ? "You're chatting with a stranger." : 'Not connected to anyone.'}
          </p>
          <div className="actions">
            <MediaControls
              state={state}
              onToggleMic={chat.toggleMic}
              onToggleCamera={chat.toggleCamera}
            />
            <button type="button" className="secondary" onClick={chat.leave}>
              Leave
            </button>
            <button type="button" className="primary" onClick={chat.next}>
              Next
            </button>
          </div>
        </div>
      </section>

      <ChatPanel messages={state.messages} canSend={active} onSend={chat.sendMessage} />
    </main>
  );
}
