import { MAX_CHAT_LENGTH } from '@meetlocal/shared';
import { Send } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatMessage } from '../../features/rooms/meetingSession';

interface ChatPanelProps {
  messages: ChatMessage[];
  /** Chat is delivered only to people currently in the meeting. */
  canSend: boolean;
  onSend: (text: string) => boolean;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ChatPanel({ messages, canSend, onSend }: ChatPanelProps) {
  const [text, setText] = useState('');
  const logRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages.length]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    if (onSend(text)) setText('');
  }

  return (
    <div className="chat">
      <ol className="chat__log" ref={logRef} aria-label="Conversation" aria-live="polite">
        {messages.length === 0 ? <li className="muted small">No messages yet.</li> : null}
        {messages.map((message) => (
          <li key={message.id} className={`chat__msg${message.own ? ' chat__msg--own' : ''}`}>
            <span className="chat__meta">
              {message.own ? 'You' : message.fromName} · {formatTime(message.sentAt)}
            </span>
            {message.text}
          </li>
        ))}
      </ol>
      <p className="muted small">
        Messages pass through the signaling server in memory only. They are not stored and disappear when you leave.
      </p>
      <form className="chat__form" onSubmit={handleSubmit}>
        <input
          className="input"
          aria-label="Chat message"
          value={text}
          maxLength={MAX_CHAT_LENGTH}
          disabled={!canSend}
          placeholder={canSend ? 'Type a message' : 'Waiting for someone to join'}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="btn btn--primary btn--sm" disabled={!canSend || !text.trim()}>
          <Send size={16} aria-hidden="true" /> Send
        </button>
      </form>
    </div>
  );
}
