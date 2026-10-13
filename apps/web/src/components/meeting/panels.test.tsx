import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatPanel } from './ChatPanel';
import { MeetingToolbar } from './MeetingToolbar';
import { ParticipantList } from './ParticipantList';

afterEach(cleanup);

const baseToolbar = {
  micEnabled: true,
  cameraEnabled: true,
  hasMic: true,
  hasCamera: true,
  onToggleMic: vi.fn(),
  onToggleCamera: vi.fn(),
  onLeave: vi.fn(),
  screenSharing: false,
  screenShareSupported: true,
  onToggleScreenShare: vi.fn(),
  openPanel: null,
  onTogglePanel: vi.fn(),
  unreadChat: 0,
};

describe('MeetingToolbar', () => {
  it('starts and stops screen sharing and shows the stop control while sharing', () => {
    const onToggleScreenShare = vi.fn();
    const { rerender } = render(<MeetingToolbar {...baseToolbar} onToggleScreenShare={onToggleScreenShare} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share screen' }));
    rerender(<MeetingToolbar {...baseToolbar} screenSharing onToggleScreenShare={onToggleScreenShare} />);
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(onToggleScreenShare).toHaveBeenCalledTimes(2);
  });

  it('disables screen sharing where the browser lacks it', () => {
    render(<MeetingToolbar {...baseToolbar} screenShareSupported={false} />);
    expect(
      (
        screen.getByRole('button', {
          name: 'Share screen',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('opens panels and shows an unread chat count', () => {
    const onTogglePanel = vi.fn();
    render(<MeetingToolbar {...baseToolbar} onTogglePanel={onTogglePanel} unreadChat={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'People' }));
    fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
    expect(onTogglePanel.mock.calls.map((c) => c[0])).toEqual(['chat', 'participants', 'devices']);
    expect(screen.getByText('3')).toBeTruthy();
  });
});

describe('ChatPanel', () => {
  const message = {
    id: '1',
    fromId: 'a',
    fromName: 'Bob',
    text: 'hello <b>there</b>',
    sentAt: 0,
    own: false,
  };

  it('shows messages as plain text', () => {
    render(<ChatPanel messages={[message]} canSend onSend={() => true} />);
    expect(screen.getByText(/hello <b>there<\/b>/)).toBeTruthy();
    expect(screen.getByText(/Bob/)).toBeTruthy();
  });

  it('sends, clears the box on success and keeps the text on failure', () => {
    const onSend = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<ChatPanel messages={[]} canSend onSend={onSend} />);
    const input = screen.getByLabelText('Chat message') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(input.value).toBe('hi');
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(input.value).toBe('');
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('is disabled until someone else is in the meeting', () => {
    render(<ChatPanel messages={[]} canSend={false} onSend={() => true} />);
    expect((screen.getByLabelText('Chat message') as HTMLInputElement).disabled).toBe(true);
  });
});

describe('ParticipantList', () => {
  it('shows each person with their mic, camera and screen state', () => {
    render(
      <ParticipantList
        participants={[
          {
            id: 'l',
            name: 'Ann',
            isYou: true,
            micEnabled: true,
            cameraEnabled: true,
            screenSharing: false,
          },
          {
            id: 'r',
            name: 'Bob',
            isYou: false,
            micEnabled: false,
            cameraEnabled: false,
            screenSharing: true,
          },
        ]}
      />,
    );
    expect(screen.getByText('Ann (you)')).toBeTruthy();
    expect(screen.getByLabelText('Microphone off')).toBeTruthy();
    expect(screen.getByLabelText('Camera off')).toBeTruthy();
    expect(screen.getByLabelText('Sharing screen')).toBeTruthy();
  });
});
