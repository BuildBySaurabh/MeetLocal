import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeetingState } from '../features/rooms/meetingSession';
import { makeFailure } from '../features/media/media.service';
import { AppRoutes } from './AppRoutes';

const ID = 'AbCdEfGhIjKlMnOpQrSt_-';

// The real hook opens WebSockets and cameras; its logic is covered in meetingSession.test.ts.
const session = vi.hoisted(() => ({
  state: null as unknown,
  toggleMic: vi.fn(),
  toggleCamera: vi.fn(),
  leave: vi.fn(),
  retry: vi.fn(),
  startScreenShare: vi.fn(),
  stopScreenShare: vi.fn(),
  selectCamera: vi.fn(),
  selectMicrophone: vi.fn(),
  sendChat: vi.fn(() => true),
  dismissNotice: vi.fn(),
}));
vi.mock('../features/rooms/useRoom', () => ({
  useMeetingSession: () => session,
}));

function meetingState(overrides: Partial<MeetingState> = {}): MeetingState {
  // Tests describe the (single) remote with the convenience fields; derive the group list from them.
  const remotes =
    overrides.remotes ??
    (overrides.remoteParticipant
      ? [
          {
            participant: overrides.remoteParticipant,
            stream: overrides.remoteStream ?? null,
            hasVideo: overrides.remoteHasVideo ?? false,
            mediaState: overrides.remoteMediaState ?? null,
            connection: overrides.status === 'connected' ? ('connected' as const) : ('connecting' as const),
          },
        ]
      : []);
  return {
    status: 'waiting',
    error: null,
    notice: null,
    localStream: null,
    remoteStream: null,
    remoteParticipant: null,
    remoteHasVideo: false,
    remoteMediaState: null,
    micEnabled: true,
    cameraEnabled: true,
    hasMic: true,
    hasCamera: true,
    cameraId: null,
    microphoneId: null,
    screenSharing: false,
    screenStream: null,
    joinedAt: null,
    chat: [],
    background: { kind: 'none' },
    backgroundStatus: { kind: 'off', message: null },
    effectStream: null,
    notes: [],
    sharingTranscript: false,
    transcriptSharers: [],
    mediaFailure: null,
    mediaNotice: null,
    ...overrides,
    remotes,
  };
}

function renderAt(path: string, state?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: path, state }]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  session.state = meetingState();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('home page', () => {
  it('shows branding, create and join controls and the privacy explanation', () => {
    renderAt('/');
    expect(screen.getByRole('button', { name: /new meeting/i })).toBeTruthy();
    expect(screen.getByLabelText(/meeting link or id/i)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /what stays where/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /settings/i })).toBeTruthy();
  });

  it('shows an error for an invalid meeting link', () => {
    renderAt('/');
    fireEvent.change(screen.getByLabelText(/meeting link or id/i), {
      target: { value: 'nonsense' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^join/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/does not look like/i);
  });

  it('opens the join page for a valid link', () => {
    renderAt('/');
    fireEvent.change(screen.getByLabelText(/meeting link or id/i), {
      target: { value: `https://meet.example.com/join/${ID}` },
    });
    fireEvent.click(screen.getByRole('button', { name: /^join/i }));
    expect(screen.getByRole('heading', { name: /join meeting/i })).toBeTruthy();
  });

  it('creates a meeting and shows its shareable link', () => {
    renderAt('/');
    fireEvent.click(screen.getByRole('button', { name: /new meeting/i }));
    expect(screen.getByRole('heading', { name: /your meeting is ready/i })).toBeTruthy();
    expect(screen.getByText(/\/join\/[A-Za-z0-9_-]{22}$/)).toBeTruthy();
  });
});

describe('join page', () => {
  it('shows a clear error for an invalid meeting link', () => {
    renderAt('/join/not-valid');
    expect(screen.getByRole('heading', { name: /invalid meeting link/i })).toBeTruthy();
  });

  it('does not touch the camera until asked and reports devices as not checked', () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    renderAt(`/join/${ID}`);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /turn on camera and microphone/i })).toBeTruthy();
    expect(screen.getAllByText('Not checked')).toHaveLength(2);
  });

  it('explains a blocked camera and offers to try again', async () => {
    const getUserMedia = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia },
      configurable: true,
    });
    renderAt(`/join/${ID}`);
    fireEvent.click(screen.getByRole('button', { name: /turn on camera and microphone/i }));
    const alert = await screen.findByText(/blocked/i, { selector: 'strong' });
    expect(alert).toBeTruthy();
    expect(screen.getAllByText('Blocked')).toHaveLength(2);
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });

  it('requires a display name before entering the meeting', () => {
    renderAt(`/join/${ID}`);
    fireEvent.click(screen.getByRole('button', { name: /join meeting/i }));
    expect(screen.getByRole('alert').textContent).toMatch(/display name is required/i);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('enters the meeting screen once a name is entered', () => {
    renderAt(`/join/${ID}`);
    fireEvent.change(screen.getByLabelText(/your name/i), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByRole('button', { name: /join meeting/i }));
    expect(screen.getByRole('toolbar', { name: /meeting controls/i })).toBeTruthy();
    expect(window.localStorage.getItem('meetlocal.displayName')).toBe('Alice');
  });
});

describe('meeting page', () => {
  it('sends users without a name back to the join page', () => {
    renderAt(`/meeting/${ID}`);
    expect(screen.getByRole('heading', { name: /join meeting/i })).toBeTruthy();
  });

  it('redirects invalid meeting ids home', () => {
    renderAt('/meeting/bad');
    expect(screen.getByRole('button', { name: /new meeting/i })).toBeTruthy();
  });

  it('shows a starting state before the session reports anything', () => {
    session.state = null;
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    expect(screen.getByText('Starting…')).toBeTruthy();
  });

  it('shows the other person as camera-off based on what they report', () => {
    session.state = meetingState({
      status: 'connected',
      remoteHasVideo: true,
      remoteParticipant: { id: 'bob-bob-bob-bob-12', displayName: 'Bob' },
      remoteMediaState: {
        micEnabled: false,
        cameraEnabled: false,
        screenSharing: false,
      },
    });
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    expect(screen.getByText('Camera off', { selector: '.tile__placeholder' })).toBeTruthy();
    expect(screen.getByLabelText('Microphone muted')).toBeTruthy();
  });

  it('shows the meeting duration once joined', () => {
    session.state = meetingState({
      status: 'connected',
      joinedAt: Date.now() - 65_000,
    });
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    expect(screen.getByLabelText('Meeting duration').textContent).toBe('01:05');
  });

  it('starts and stops screen sharing from the toolbar', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getDisplayMedia: vi.fn() },
      configurable: true,
    });
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    fireEvent.click(screen.getByRole('button', { name: 'Share screen' }));
    expect(session.startScreenShare).toHaveBeenCalled();
    cleanup();
    session.state = meetingState({ screenSharing: true });
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(session.stopScreenShare).toHaveBeenCalled();
  });

  it('opens chat, sends a message and clears the unread count', () => {
    session.state = meetingState({
      status: 'connected',
      remoteParticipant: { id: 'bob-bob-bob-bob-12', displayName: 'Bob' },
      chat: [
        {
          id: '1',
          fromId: 'b',
          fromName: 'Bob',
          text: 'ping',
          sentAt: 0,
          own: false,
        },
      ],
    });
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    expect(screen.getByText('1', { selector: '.toolbar__badge' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Chat/ }));
    expect(screen.getByText('ping')).toBeTruthy();
    expect(document.querySelector('.toolbar__badge')).toBeNull();
    fireEvent.change(screen.getByLabelText('Chat message'), {
      target: { value: 'pong' },
    });
    fireEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(session.sendChat).toHaveBeenCalledWith('pong');
  });

  it('shows a dismissible notice', () => {
    session.state = meetingState({
      notice: { id: 1, kind: 'error', text: 'Slow down' },
    });
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    expect(screen.getByText('Slow down')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(session.dismissNotice).toHaveBeenCalled();
  });

  it('shows the real session status, not a fixed one', () => {
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    expect(screen.getByText('Waiting for others to join')).toBeTruthy();
    expect(screen.queryByText('Connected')).toBeNull();
    cleanup();

    session.state = meetingState({
      status: 'connected',
      remoteParticipant: { id: 'bob-bob-bob-bob-12', displayName: 'Bob' },
    });
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getByLabelText('Bob')).toBeTruthy();
  });

  it('wires mute, camera and leave to the session', () => {
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop video' }));
    expect(session.toggleMic).toHaveBeenCalledTimes(1);
    expect(session.toggleCamera).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(session.leave).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /new meeting/i })).toBeTruthy();
  });

  it('disables mute and camera controls when the devices do not exist; screen share is disabled where the browser lacks it', () => {
    session.state = meetingState({
      hasMic: false,
      hasCamera: false,
      micEnabled: false,
      cameraEnabled: false,
    });
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true });
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    expect((screen.getByRole('button', { name: 'Unmute' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Start video' }) as HTMLButtonElement).disabled).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'Share screen',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('explains a media failure and lets the user retry', () => {
    session.state = meetingState({
      mediaFailure: makeFailure('permission-denied'),
      hasMic: false,
      hasCamera: false,
    });
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    expect(screen.getByRole('alert').textContent).toMatch(/blocked/i);
    fireEvent.click(screen.getByRole('button', { name: /try camera and microphone again/i }));
    expect(session.retry).toHaveBeenCalled();
  });

  it('shows a recoverable error screen when the connection fails', () => {
    session.state = meetingState({
      status: 'failed',
      error: {
        code: 'room-full',
        title: 'This meeting is full',
        message: 'Both spots are taken.',
        recovery: 'Start a new one.',
      },
    });
    renderAt(`/meeting/${ID}`, { displayName: 'Alice' });
    expect(screen.getByRole('heading', { name: /this meeting is full/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(session.retry).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: /back to home/i })).toBeTruthy();
  });
});

describe('settings page', () => {
  it('saves and deletes the display name', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderAt('/settings');
    fireEvent.change(screen.getByLabelText(/default display name/i), {
      target: { value: 'Bob' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(window.localStorage.getItem('meetlocal.displayName')).toBe('Bob');

    fireEvent.click(screen.getByRole('button', { name: /delete saved settings/i }));
    expect(window.localStorage.getItem('meetlocal.displayName')).toBeNull();
  });

  it('keeps data when deletion is not confirmed', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    window.localStorage.setItem('meetlocal.displayName', 'Bob');
    renderAt('/settings');
    fireEvent.click(screen.getByRole('button', { name: /delete saved settings/i }));
    expect(window.localStorage.getItem('meetlocal.displayName')).toBe('Bob');
  });
});

describe('unknown routes', () => {
  it('shows a not-found page', () => {
    renderAt('/nope');
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeTruthy();
  });
});
