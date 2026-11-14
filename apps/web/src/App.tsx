import { Conversation } from './components/Conversation.tsx';
import { Landing } from './components/Landing.tsx';
import { Waiting } from './components/Waiting.tsx';
import { useChat } from './hooks/useChat.ts';
import { getServerUrl } from './services/socket.ts';

const serverUrl = getServerUrl();

/** Chooses the screen from the chat state. All behaviour lives in useChat / chatMachine. */
export function App() {
  const chat = useChat(serverUrl);
  const { state } = chat;

  if (state.phase === 'waiting') return <Waiting onCancel={chat.leave} />;

  if (state.phase === 'in_session' || state.phase === 'partner_left') {
    return (
      <Conversation
        state={state}
        onNext={chat.next}
        onLeave={chat.leave}
        onSend={chat.sendMessage}
      />
    );
  }

  return (
    <Landing
      state={state}
      onStart={chat.start}
      onDismissNotice={chat.dismissNotice}
      onRetryConnection={chat.retryConnection}
    />
  );
}
