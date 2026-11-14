import { Conversation } from './components/Conversation.tsx';
import { Landing } from './components/Landing.tsx';
import { MediaSetup } from './components/MediaSetup.tsx';
import { Waiting } from './components/Waiting.tsx';
import { useChat } from './hooks/useChat.ts';
import { getServerUrl } from './services/socket.ts';

const serverUrl = getServerUrl();

/** Chooses the screen from the chat state. All behaviour lives in ChatController. */
export function App() {
  const chat = useChat(serverUrl);
  const { state } = chat;

  switch (state.phase) {
    case 'requesting_media':
    case 'media_error':
      return <MediaSetup state={state} onRetry={chat.start} onBack={chat.leave} />;
    case 'waiting':
      return <Waiting chat={chat} />;
    case 'in_session':
    case 'partner_left':
      return <Conversation chat={chat} />;
    case 'idle':
      return (
        <Landing
          state={state}
          onStart={chat.start}
          onDismissNotice={chat.dismissNotice}
          onRetryConnection={chat.retryConnection}
        />
      );
  }
}
