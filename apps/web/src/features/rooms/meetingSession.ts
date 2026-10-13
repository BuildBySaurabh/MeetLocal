import {
  MAX_CHAT_LENGTH,
  MAX_TRANSCRIPT_SEGMENT_LENGTH,
  type ClientMessage,
  type MediaState,
  type Participant,
  type ServerMessage,
  type SignalingErrorCode,
} from '@meetlocal/shared';
import type { MediaFailure, MediaResult, ScreenResult, TrackResult } from '../media/media.types';
import { stopStream } from '../media/media.service';
import type { SignalingHandlers } from '../signaling/signalingClient';
import type { PeerCallbacks, PeerLike, PeerOptions, PeerState } from '../webrtc/peerConnection';
import type { JoinIntent } from './room.types';
import {
  BACKGROUND_OFF,
  NO_BACKGROUND,
  type BackgroundMode,
  type BackgroundStatus,
} from '../background/background.types';
import type { BackgroundProcessorLike } from '../background/backgroundProcessor';

export type SessionStatus = 'starting' | 'waiting' | 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'ended';

export interface SessionError {
  code: SignalingErrorCode | 'ice-failed' | 'signaling-unavailable' | 'negotiation-failed';
  title: string;
  message: string;
  recovery: string;
}

/** A short-lived message for things that went wrong without ending the call. */
export interface SessionNotice {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

export interface ChatMessage {
  id: string;
  fromId: string;
  fromName: string;
  text: string;
  /** Milliseconds since epoch (server clock for received messages, local clock for your own). */
  sentAt: number;
  own: boolean;
}

/** Everything the UI needs to draw one remote participant. */
export interface RemoteParticipantState {
  participant: Participant;
  stream: MediaStream | null;
  hasVideo: boolean;
  /** What they say about their mic/camera/screen. Null until they tell us. */
  mediaState: MediaState | null;
  connection: PeerState;
}

/** One line of the shared meeting notes: who said it and when. Memory only. */
export interface NoteEntry {
  id: string;
  speakerId: string;
  speakerName: string;
  text: string;
  /** Milliseconds since epoch (server clock for others, local clock for your own lines). */
  at: number;
  own: boolean;
}

export interface MeetingState {
  status: SessionStatus;
  error: SessionError | null;
  notice: SessionNotice | null;
  localStream: MediaStream | null;
  /** Every other participant, in join order (group calls: a full mesh, one peer connection each). */
  remotes: RemoteParticipantState[];
  /** Convenience copies of the first remote participant (the only one in a one-to-one call). */
  remoteStream: MediaStream | null;
  remoteParticipant: Participant | null;
  remoteHasVideo: boolean;
  remoteMediaState: MediaState | null;
  micEnabled: boolean;
  cameraEnabled: boolean;
  hasMic: boolean;
  hasCamera: boolean;
  /** Device IDs of the tracks currently in use (null if none). */
  cameraId: string | null;
  microphoneId: string | null;
  screenSharing: boolean;
  screenStream: MediaStream | null;
  /** Set when camera/microphone could not be opened at all. */
  mediaFailure: MediaFailure | null;
  /** Set when only one of camera/microphone was available. */
  mediaNotice: string | null;
  /** When this participant first joined the meeting (ms since epoch). */
  joinedAt: number | null;
  /** Chat history. Memory only: never stored, discarded when you leave. */
  chat: ChatMessage[];
  /** Background effect applied to the video others see. */
  background: BackgroundMode;
  backgroundStatus: BackgroundStatus;
  /** The processed camera picture (shown in your own tile) while an effect is on. */
  effectStream: MediaStream | null;
  /** Shared meeting notes (your own lines plus lines others chose to share). Memory only. */
  notes: NoteEntry[];
  /** True while you are sending your own transcript lines to the others. */
  sharingTranscript: boolean;
  /** Ids of other participants who are currently sharing their transcript lines. */
  transcriptSharers: string[];
}

export interface SignalingLike {
  connect(): void;
  send(message: ClientMessage): boolean;
  close(): void;
}

export interface MeetingDeps {
  requestMedia(): Promise<MediaResult>;
  requestScreenShare(): Promise<ScreenResult>;
  requestTrack(kind: 'video' | 'audio', deviceId: string): Promise<TrackResult>;
  createStream(tracks: MediaStreamTrack[]): MediaStream;
  createSignaling(handlers: SignalingHandlers): SignalingLike;
  createPeer(options: PeerOptions, callbacks: PeerCallbacks): PeerLike;
  /** Creates the camera background effect. Absent in environments that cannot draw video to a canvas. */
  createBackgroundProcessor?(): BackgroundProcessorLike;
  iceServers: RTCIceServer[];
  generateParticipantId(): string;
  now?(): number;
  /** Delay before reconnect attempt N (0-based); injectable so tests do not wait. */
  reconnectDelayMs?(attempt: number): number;
}

export interface MeetingOptions {
  roomId: string;
  displayName: string;
  intent: JoinIntent;
}

const MAX_RECONNECT_ATTEMPTS = 3;
const MAX_CHAT_HISTORY = 500;
const MAX_NOTES = 3000;

const SIGNALING_ERRORS: Partial<Record<SignalingErrorCode, Omit<SessionError, 'code'>>> = {
  'room-not-found': {
    title: 'Meeting not found',
    message: 'This meeting does not exist or has already ended.',
    recovery: 'Check the link with the person who invited you, or start a new meeting.',
  },
  'room-full': {
    title: 'This meeting is full',
    message: 'This meeting already has the maximum number of people (MeetLocal group calls are limited because every person connects directly to every other person).',
    recovery: 'Ask the host to confirm who is in the meeting, or start a new one.',
  },
  'duplicate-participant': {
    title: 'Already connected',
    message: 'This connection is already part of the meeting.',
    recovery: 'Close other tabs of this meeting and try again.',
  },
  'rate-limited': {
    title: 'Too many requests',
    message: 'The meeting server asked this browser to slow down.',
    recovery: 'Wait a few seconds and try again.',
  },
};

function initialState(): MeetingState {
  return {
    status: 'starting',
    error: null,
    notice: null,
    localStream: null,
    remotes: [],
    remoteStream: null,
    remoteParticipant: null,
    remoteHasVideo: false,
    remoteMediaState: null,
    micEnabled: false,
    cameraEnabled: false,
    hasMic: false,
    hasCamera: false,
    cameraId: null,
    microphoneId: null,
    screenSharing: false,
    screenStream: null,
    mediaFailure: null,
    mediaNotice: null,
    joinedAt: null,
    chat: [],
    background: NO_BACKGROUND,
    backgroundStatus: BACKGROUND_OFF,
    effectStream: null,
    notes: [],
    sharingTranscript: false,
    transcriptSharers: [],
  };
}

function deviceIdOf(track: MediaStreamTrack | undefined): string | null {
  return track?.getSettings?.().deviceId ?? null;
}

/**
 * Orchestrates one participant's presence in a meeting: local media, the signaling
 * connection and one peer connection per other participant (a full mesh; there is no media
 * server). It has no React dependency; a hook subscribes to its state.
 *
 * Roles: for every pair, the participant who was already in the room creates the offer and the
 * newcomer only answers. This avoids offer collisions without needing "perfect negotiation".
 */
export class MeetingSession {
  private state: MeetingState = initialState();
  private listeners = new Set<(state: MeetingState) => void>();
  private signaling: SignalingLike | null = null;
  private readonly peers = new Map<string, { peer: PeerLike; remote: RemoteParticipantState }>();
  /** Names of everyone seen in this session, so chat from someone who left still shows a name. */
  private readonly names = new Map<string, string>();
  private participantId = '';
  private ended = false;
  /** True from a signaling drop until we have rejoined; peer events must not overwrite 'reconnecting' then. */
  private signalingDown = false;
  private started = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private screenTrack: MediaStreamTrack | null = null;
  private processor: BackgroundProcessorLike | null = null;
  private effectTrack: MediaStreamTrack | null = null;
  private noticeCounter = 0;
  private chatCounter = 0;
  private noteCounter = 0;

  constructor(
    private readonly options: MeetingOptions,
    private readonly deps: MeetingDeps,
  ) {}

  getState(): MeetingState {
    return this.state;
  }

  /** Subscribes and immediately delivers the current state. Returns an unsubscribe function. */
  subscribe(listener: (state: MeetingState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private update(patch: Partial<MeetingState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private notify(kind: SessionNotice['kind'], text: string): void {
    this.noticeCounter += 1;
    this.update({ notice: { id: this.noticeCounter, kind, text } });
  }

  dismissNotice(): void {
    if (this.state.notice) this.update({ notice: null });
  }

  async start(): Promise<void> {
    if (this.started || this.ended) return;
    this.started = true;

    const media = await this.deps.requestMedia();
    if (this.ended) {
      // Left while the permission prompt was open: release the devices right away.
      if (media.ok) stopStream(media.stream);
      return;
    }

    if (media.ok) {
      const audio = media.stream.getAudioTracks()[0];
      const video = media.stream.getVideoTracks()[0];
      this.update({
        localStream: media.stream,
        hasMic: !!audio,
        hasCamera: !!video,
        micEnabled: !!audio,
        cameraEnabled: !!video,
        microphoneId: deviceIdOf(audio),
        cameraId: deviceIdOf(video),
        mediaNotice: media.missing.length
          ? `No ${media.missing.join(' or ')} found. You are joining with ${audio ? 'microphone' : 'camera'} only.`
          : null,
      });
      this.watchTrack(audio, 'microphone');
      this.watchTrack(video, 'camera');
    } else {
      this.update({ mediaFailure: media.failure });
    }

    this.connectSignaling();
  }

  // ---------------------------------------------------------------------------
  // Signaling
  // ---------------------------------------------------------------------------

  private connectSignaling(): void {
    this.participantId = this.deps.generateParticipantId();
    const signaling = this.deps.createSignaling({
      onOpen: () => {
        this.reconnectAttempts = 0;
        signaling.send({
          type: 'join',
          roomId: this.options.roomId,
          participantId: this.participantId,
          displayName: this.options.displayName,
          intent: this.options.intent,
        });
      },
      onMessage: (message) => void this.handleServerMessage(message),
      onClose: () => this.handleSignalingClosed(),
    });
    this.signaling = signaling;
    signaling.connect();
  }

  private handleSignalingClosed(): void {
    if (this.ended || this.state.status === 'failed') return;
    // The server removes us from the room when the socket closes, so the peer connection
    // is torn down and rebuilt after we rejoin.
    this.signalingDown = true;
    this.closeAllPeers();
    this.signaling = null;
    this.update({ status: 'reconnecting', transcriptSharers: [] });

    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.fail({
        code: 'signaling-unavailable',
        title: 'Cannot reach the meeting server',
        message: 'MeetLocal could not connect to the signaling server, so the call cannot be set up.',
        recovery: 'Check your internet connection and that the signaling server is running, then try again.',
      });
      return;
    }
    const delay = this.deps.reconnectDelayMs?.(this.reconnectAttempts) ?? 1000 * 2 ** this.reconnectAttempts;
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      if (!this.ended) this.connectSignaling();
    }, delay);
  }

  private async handleServerMessage(message: ServerMessage): Promise<void> {
    if (this.ended) return;
    try {
      switch (message.type) {
        case 'joined':
          this.handleJoined(message.participants);
          break;
        case 'participant-joined':
          await this.handleParticipantJoined(message.participant);
          break;
        case 'participant-left':
          if (this.state.transcriptSharers.includes(message.participantId)) {
            this.update({ transcriptSharers: this.state.transcriptSharers.filter((id) => id !== message.participantId) });
          }
          if (this.peers.has(message.participantId)) {
            this.removePeer(message.participantId);
            this.syncRemotes();
          }
          break;
        case 'offer':
          await this.peers.get(message.from)?.peer.handleOffer(message.description);
          break;
        case 'answer':
          await this.peers.get(message.from)?.peer.handleAnswer(message.description);
          break;
        case 'ice-candidate':
          await this.peers.get(message.from)?.peer.handleIceCandidate(message.candidate);
          break;
        case 'media-state':
          if (this.peers.has(message.from)) {
            this.patchRemote(message.from, {
              mediaState: {
                micEnabled: message.micEnabled,
                cameraEnabled: message.cameraEnabled,
                screenSharing: message.screenSharing,
              },
            });
            this.syncRemotes();
          }
          break;
        case 'chat':
          this.receiveChat(message.from, message.text, message.sentAt);
          break;
        case 'transcript-sharing':
          if (message.enabled && !this.state.transcriptSharers.includes(message.from)) {
            this.notify('info', `${this.names.get(message.from) ?? 'Someone'} is sharing their transcript lines in the meeting notes.`);
          }
          this.update({
            transcriptSharers: message.enabled
              ? [...new Set([...this.state.transcriptSharers, message.from])]
              : this.state.transcriptSharers.filter((id) => id !== message.from),
          });
          break;
        case 'transcript-segment':
          this.appendNote({
            id: this.nextNoteId(),
            speakerId: message.from,
            speakerName: this.names.get(message.from) ?? 'Participant',
            text: message.text,
            at: message.sentAt,
            own: false,
          });
          break;
        case 'error':
          this.handleServerError(message.code, message.message);
          break;
      }
    } catch (error) {
      console.error('Failed to process signaling message', error);
      this.fail({
        code: 'negotiation-failed',
        title: 'Could not set up the call',
        message: 'The connection to the other participant could not be negotiated.',
        recovery: 'Try again. If it keeps happening, both people can try a different browser.',
      });
    }
  }

  private handleJoined(others: Participant[]): void {
    this.signalingDown = false;
    // After a reconnect the server has forgotten that we were sharing: announce it again.
    if (this.state.sharingTranscript) this.signaling?.send({ type: 'transcript-sharing', enabled: true });
    for (const participant of others) this.names.set(participant.id, participant.displayName);
    if (this.state.joinedAt === null) this.update({ joinedAt: (this.deps.now ?? Date.now)() });
    if (others.length === 0) {
      this.update({ status: 'waiting' });
      return;
    }
    // We are the newcomer: wait for each existing participant's offer.
    for (const existing of others) this.createPeer(existing, false);
    this.syncRemotes();
  }

  private async handleParticipantJoined(participant: Participant): Promise<void> {
    // A repeat announcement for the same id replaces the old connection.
    this.removePeer(participant.id);
    const peer = this.createPeer(participant, true);
    this.syncRemotes();
    await peer.createOffer();
  }

  private handleServerError(code: SignalingErrorCode, serverMessage: string): void {
    // A relay can race with the recipient leaving; that is not worth interrupting the user.
    if (code === 'unknown-recipient') return;
    // Chat or state updates can be rejected without ending the call.
    if (code === 'invalid-message' || code === 'message-too-large' || code === 'rate-limited') {
      if (this.state.status === 'connected' || this.state.status === 'waiting') {
        this.notify(
          'error',
          code === 'rate-limited' ? 'You are sending too fast. Slow down a little.' : 'The server rejected a message.',
        );
        return;
      }
    }
    const known = SIGNALING_ERRORS[code];
    this.fail({
      code,
      title: known?.title ?? 'The meeting server reported a problem',
      message: known?.message ?? serverMessage,
      recovery: known?.recovery ?? 'Try again. If it keeps happening, restart the signaling server.',
    });
  }

  // ---------------------------------------------------------------------------
  // Peer connection
  // ---------------------------------------------------------------------------

  private createPeer(remote: Participant, isOfferer: boolean): PeerLike {
    this.names.set(remote.id, remote.displayName);
    const peer = this.deps.createPeer(
      { iceServers: this.deps.iceServers, localStream: this.state.localStream, isOfferer },
      {
        onLocalDescription: (description) => {
          this.signaling?.send({ type: description.type, to: remote.id, description } as ClientMessage);
        },
        onIceCandidate: (candidate) => {
          this.signaling?.send({ type: 'ice-candidate', to: remote.id, candidate });
        },
        onRemoteStream: (stream) => {
          if (this.peers.get(remote.id)?.peer !== peer) return;
          this.patchRemote(remote.id, { stream, hasVideo: stream.getVideoTracks().length > 0 });
          this.syncRemotes();
        },
        onStateChange: (peerState) => {
          if (this.peers.get(remote.id)?.peer === peer) this.handlePeerState(remote.id, peerState);
        },
      },
    );
    this.peers.set(remote.id, {
      peer,
      remote: { participant: remote, stream: null, hasVideo: false, mediaState: null, connection: 'connecting' },
    });
    // If we are already sharing our screen, send it instead of the camera to the new peer.
    const outgoing = this.screenTrack ?? this.effectTrack;
    if (outgoing) {
      peer.replaceVideoTrack(outgoing).catch((error: unknown) => {
        console.warn('Could not send screen or background effect to new peer', error);
      });
    }
    // Tell everyone our current mic/camera/screen state (cheap, and the new peer needs it).
    this.sendMediaState();
    return peer;
  }

  private patchRemote(id: string, patch: Partial<RemoteParticipantState>): void {
    const entry = this.peers.get(id);
    if (entry) entry.remote = { ...entry.remote, ...patch };
  }

  /** Publishes the peer map into state, deriving the overall status from the individual connections. */
  private syncRemotes(): void {
    const remotes = [...this.peers.values()].map((entry) => entry.remote);
    const first = remotes[0] ?? null;
    const patch: Partial<MeetingState> = {
      remotes,
      remoteParticipant: first?.participant ?? null,
      remoteStream: first?.stream ?? null,
      remoteHasVideo: first?.hasVideo ?? false,
      remoteMediaState: first?.mediaState ?? null,
    };
    if (!this.ended && this.state.status !== 'failed' && !this.signalingDown) {
      if (remotes.length === 0) patch.status = 'waiting';
      else if (remotes.some((r) => r.connection === 'connected')) patch.status = 'connected';
      else if (remotes.some((r) => r.connection === 'reconnecting')) patch.status = 'reconnecting';
      else patch.status = 'connecting';
    }
    this.update(patch);
  }

  private handlePeerState(id: string, peerState: PeerState): void {
    if (this.ended) return;
    this.patchRemote(id, { connection: peerState });
    if (peerState === 'failed') {
      const others = [...this.peers.entries()].filter(([otherId]) => otherId !== id);
      const anyAlive = others.some(([, e]) => e.remote.connection !== 'failed' && e.remote.connection !== 'closed');
      if (!anyAlive) {
        this.fail({
          code: 'ice-failed',
          title: 'Could not connect directly',
          message:
            'MeetLocal could not find a network path between you and the other person. This is common when either of you is behind a strict firewall or mobile network, where a relay (TURN) server is needed. No relay is configured.',
          recovery: 'Try again, switch networks, or ask your host to configure a TURN server.',
        });
        return;
      }
      const name = this.peers.get(id)?.remote.participant.displayName ?? 'a participant';
      this.notify('error', `Could not connect to ${name}. The others are still connected.`);
    }
    if (peerState === 'closed') return;
    this.syncRemotes();
  }

  private removePeer(id: string): void {
    const entry = this.peers.get(id);
    if (!entry) return;
    this.peers.delete(id);
    entry.peer.close();
  }

  private closeAllPeers(): void {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.syncRemotes();
  }

  /** Applies a track change to every peer connection. */
  private allPeers(action: (peer: PeerLike) => Promise<void>): Promise<void> {
    return Promise.all([...this.peers.values()].map((entry) => action(entry.peer))).then(() => undefined);
  }

  private fail(error: SessionError): void {
    if (this.ended) return;
    this.closeAllPeers();
    this.signaling?.close();
    this.signaling = null;
    clearTimeout(this.reconnectTimer);
    this.update({ status: 'failed', error });
  }

  // ---------------------------------------------------------------------------
  // Local media state, controls and devices
  // ---------------------------------------------------------------------------

  private currentMediaState(): MediaState {
    return {
      micEnabled: this.state.hasMic && this.state.micEnabled,
      cameraEnabled: this.state.hasCamera && this.state.cameraEnabled,
      screenSharing: this.state.screenSharing,
    };
  }

  /** Tells the other participant what to display for us (mic/camera/screen). Contains no media. */
  private sendMediaState(): void {
    this.signaling?.send({ type: 'media-state', ...this.currentMediaState() });
  }

  toggleMic(): void {
    const tracks = this.state.localStream?.getAudioTracks() ?? [];
    if (tracks.length === 0) return;
    const enabled = !this.state.micEnabled;
    for (const track of tracks) track.enabled = enabled;
    this.update({ micEnabled: enabled });
    this.sendMediaState();
  }

  toggleCamera(): void {
    const tracks = this.state.localStream?.getVideoTracks() ?? [];
    if (tracks.length === 0) return;
    const enabled = !this.state.cameraEnabled;
    for (const track of tracks) track.enabled = enabled;
    this.update({ cameraEnabled: enabled });
    this.sendMediaState();
  }

  /** Reacts to a device disappearing (unplugged, or permission revoked). */
  private watchTrack(track: MediaStreamTrack | undefined, label: 'camera' | 'microphone'): void {
    if (!track) return;
    // "ended" is not fired when we call stop() ourselves, so it always means the device went away.
    track.onended = () => {
      if (this.ended || !this.state.localStream?.getTracks().includes(track)) return;
      if (label === 'camera') {
        this.update({ hasCamera: false, cameraEnabled: false, cameraId: null });
        this.stopBackground();
        if (!this.screenTrack) this.allPeers((p) => p.replaceVideoTrack(null)).catch(this.logReplaceError);
      } else {
        this.update({ hasMic: false, micEnabled: false, microphoneId: null });
        this.allPeers((p) => p.replaceAudioTrack(null)).catch(this.logReplaceError);
      }
      this.notify('error', `Your ${label} was disconnected. Plug it back in or choose another device in Devices.`);
      this.sendMediaState();
    };
  }

  private readonly logReplaceError = (error: unknown): void => {
    console.warn('Could not update outgoing track', error);
  };

  /** Switches to another camera mid-call. Failures leave the current camera untouched. */
  async selectCamera(deviceId: string): Promise<void> {
    await this.switchDevice('video', deviceId);
  }

  async selectMicrophone(deviceId: string): Promise<void> {
    await this.switchDevice('audio', deviceId);
  }

  private async switchDevice(kind: 'video' | 'audio', deviceId: string): Promise<void> {
    if (this.ended) return;
    const label = kind === 'video' ? 'camera' : 'microphone';
    const result = await this.deps.requestTrack(kind, deviceId);
    if (this.ended) {
      if (result.ok) result.track.stop();
      return;
    }
    if (!result.ok) {
      this.notify('error', `${result.failure.message} ${result.failure.recovery}`);
      return;
    }

    const newTrack = result.track;
    const oldStream = this.state.localStream;
    const oldTracks = oldStream?.getTracks() ?? [];
    const replaced = oldTracks.filter((t) => t.kind === kind);
    const kept = oldTracks.filter((t) => t.kind !== kind);
    const wasEnabled = kind === 'video' ? this.state.cameraEnabled : this.state.micEnabled;
    const hadDevice = kind === 'video' ? this.state.hasCamera : this.state.hasMic;
    // Keep the user's mute/camera-off choice; a brand-new device (none before) starts enabled.
    newTrack.enabled = hadDevice ? wasEnabled : true;

    // A new stream object makes the video element and level meter re-attach to the new track.
    const newStream = this.deps.createStream([...kept, newTrack]);
    try {
      if (kind === 'video') {
        if (this.processor) this.processor.setSource(newTrack);
        else if (!this.screenTrack) await this.allPeers((p) => p.replaceVideoTrack(newTrack));
      } else {
        await this.allPeers((p) => p.replaceAudioTrack(newTrack));
      }
    } catch (error) {
      console.warn('Could not switch device on the call', error);
      newTrack.stop();
      this.notify('error', `Could not switch your ${label}. Your previous ${label} is still in use.`);
      return;
    }
    for (const track of replaced) {
      track.onended = null;
      track.stop();
    }

    this.update(
      kind === 'video'
        ? {
            localStream: newStream,
            hasCamera: true,
            cameraEnabled: newTrack.enabled,
            cameraId: deviceIdOf(newTrack) ?? deviceId,
          }
        : {
            localStream: newStream,
            hasMic: true,
            micEnabled: newTrack.enabled,
            microphoneId: deviceIdOf(newTrack) ?? deviceId,
          },
    );
    this.watchTrack(newTrack, label);
    this.sendMediaState();
  }

  // ---------------------------------------------------------------------------
  // Screen sharing
  // ---------------------------------------------------------------------------

  /** Starts sharing the screen in place of the camera picture. Call from a user action. */
  async startScreenShare(): Promise<void> {
    if (this.ended || this.state.screenSharing) return;
    const result = await this.deps.requestScreenShare();
    if (this.ended) {
      if (result.ok) stopStream(result.stream);
      return;
    }
    if (!result.ok) {
      // A cancelled picker is a normal choice, not an error.
      this.notify(result.cancelled ? 'info' : 'error', result.message);
      return;
    }

    const track = result.stream.getVideoTracks()[0];
    if (!track) {
      stopStream(result.stream);
      this.notify('error', 'No screen was captured.');
      return;
    }
    // Fires when the user clicks the browser's own "Stop sharing" button.
    track.onended = () => void this.stopScreenShare();

    try {
      await this.allPeers((p) => p.replaceVideoTrack(track));
    } catch (error) {
      console.warn('Could not send screen', error);
      stopStream(result.stream);
      this.notify('error', 'Could not start screen sharing on this call.');
      return;
    }
    this.screenTrack = track;
    this.update({ screenSharing: true, screenStream: result.stream });
    this.sendMediaState();
  }

  async stopScreenShare(): Promise<void> {
    const track = this.screenTrack;
    if (!track) return;
    this.screenTrack = null;
    track.onended = null;
    stopStream(this.state.screenStream);
    this.update({ screenSharing: false, screenStream: null });
    if (!this.ended) {
      // Go back to sending the camera (or nothing if there is no camera).
      const camera = this.effectTrack ?? this.state.localStream?.getVideoTracks()[0] ?? null;
      try {
        await this.allPeers((p) => p.replaceVideoTrack(camera));
      } catch (error) {
        console.warn('Could not restore camera after screen share', error);
      }
      this.sendMediaState();
    }
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  /** Returns true if the message was sent. Chat is only available while someone else is present. */
  sendChat(rawText: string): boolean {
    const text = rawText.trim();
    if (!text) return false;
    if (text.length > MAX_CHAT_LENGTH) {
      this.notify('error', `Messages can be up to ${MAX_CHAT_LENGTH} characters.`);
      return false;
    }
    if (this.peers.size === 0) {
      this.notify('info', 'Chat is available once someone else has joined the meeting.');
      return false;
    }
    if (!this.signaling?.send({ type: 'chat', text })) {
      this.notify('error', 'Message not sent: the connection to the meeting server was lost.');
      return false;
    }
    this.appendChat({
      id: this.nextChatId(),
      fromId: this.participantId,
      fromName: this.options.displayName,
      text,
      sentAt: (this.deps.now ?? Date.now)(),
      own: true,
    });
    return true;
  }

  private receiveChat(fromId: string, text: string, sentAt: number): void {
    this.appendChat({
      id: this.nextChatId(),
      fromId,
      fromName: this.names.get(fromId) ?? 'Participant',
      text,
      sentAt,
      own: false,
    });
  }

  private nextChatId(): string {
    this.chatCounter += 1;
    return `chat-${this.chatCounter}`;
  }

  private appendChat(message: ChatMessage): void {
    this.update({ chat: [...this.state.chat, message].slice(-MAX_CHAT_HISTORY) });
  }

  // ---------------------------------------------------------------------------
  // Background effect
  // ---------------------------------------------------------------------------

  /**
   * Blurs or replaces the background of your camera picture, on this device, for everyone you are
   * connected to. "none" goes back to the plain camera picture. While you share your screen, the
   * effect is prepared but the screen is what others see.
   */
  setBackground(mode: BackgroundMode): void {
    if (this.ended) return;
    if (mode.kind === 'none') {
      this.stopBackground();
      return;
    }
    const camera = this.state.localStream?.getVideoTracks()[0];
    if (!camera || !this.deps.createBackgroundProcessor) {
      this.notify('error', camera ? 'Background effects are not supported in this browser.' : 'Turn on a camera first.');
      return;
    }
    if (this.processor) {
      this.processor.setMode(mode);
      this.update({ background: mode });
      return;
    }
    const processor = this.deps.createBackgroundProcessor();
    let track: MediaStreamTrack;
    try {
      track = processor.start(camera, mode, (event) => {
        if (this.processor !== processor) return;
        if (event.type === 'ready') {
          this.update({ backgroundStatus: { kind: 'on', message: null } });
        } else {
          this.stopBackground();
          this.update({ backgroundStatus: { kind: 'unavailable', message: event.message } });
          this.notify('error', event.message);
        }
      });
    } catch (error) {
      console.warn('Could not start the background effect', error);
      processor.stop();
      this.notify('error', 'Background effects are not supported in this browser.');
      return;
    }
    this.processor = processor;
    this.effectTrack = track;
    this.update({
      background: mode,
      backgroundStatus: { kind: 'loading', message: null },
      effectStream: this.deps.createStream([track]),
    });
    if (!this.screenTrack) {
      this.allPeers((p) => p.replaceVideoTrack(track)).catch(this.logReplaceError);
    }
  }

  private stopBackground(): void {
    const processor = this.processor;
    if (!processor) {
      if (this.state.background.kind !== 'none') this.update({ background: NO_BACKGROUND, backgroundStatus: BACKGROUND_OFF });
      return;
    }
    this.processor = null;
    this.effectTrack = null;
    processor.stop();
    const camera = this.state.localStream?.getVideoTracks()[0] ?? null;
    this.update({ background: NO_BACKGROUND, backgroundStatus: BACKGROUND_OFF, effectStream: null });
    if (!this.screenTrack && !this.ended) {
      this.allPeers((p) => p.replaceVideoTrack(camera)).catch(this.logReplaceError);
    }
  }

  // ---------------------------------------------------------------------------
  // Shared meeting notes
  // ---------------------------------------------------------------------------

  /**
   * Starts or stops sending your own transcript lines to the others. Others are told when you turn
   * it on, and the server refuses lines from anyone who has not announced it.
   */
  setTranscriptSharing(enabled: boolean): void {
    if (this.ended || this.state.sharingTranscript === enabled) return;
    if (enabled && !this.signaling?.send({ type: 'transcript-sharing', enabled: true })) {
      this.notify('error', 'Could not start sharing: the connection to the meeting server was lost.');
      return;
    }
    if (!enabled) this.signaling?.send({ type: 'transcript-sharing', enabled: false });
    this.update({ sharingTranscript: enabled });
  }

  /** Adds a line you spoke (from local transcription) to the notes, and shares it if sharing is on. */
  recordOwnSpeech(rawText: string): void {
    const text = rawText.trim().slice(0, MAX_TRANSCRIPT_SEGMENT_LENGTH);
    if (this.ended || !text) return;
    if (this.state.sharingTranscript) this.signaling?.send({ type: 'transcript-segment', text });
    this.appendNote({
      id: this.nextNoteId(),
      speakerId: this.participantId,
      speakerName: this.options.displayName,
      text,
      at: (this.deps.now ?? Date.now)(),
      own: true,
    });
  }

  clearNotes(): void {
    if (this.state.notes.length) this.update({ notes: [] });
  }

  private nextNoteId(): string {
    this.noteCounter += 1;
    return `note-${this.noteCounter}`;
  }

  private appendNote(note: NoteEntry): void {
    this.update({ notes: [...this.state.notes, note].slice(-MAX_NOTES) });
  }

  // ---------------------------------------------------------------------------
  // Leaving
  // ---------------------------------------------------------------------------

  /** Leaves the meeting and releases every resource. Safe to call more than once. */
  leave(): void {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.reconnectTimer);
    this.signaling?.send({ type: 'leave' });
    this.signaling?.close();
    this.signaling = null;
    this.processor?.stop();
    this.processor = null;
    this.effectTrack = null;
    this.closeAllPeers();
    for (const track of this.state.localStream?.getTracks() ?? []) track.onended = null;
    stopStream(this.state.localStream);
    if (this.screenTrack) this.screenTrack.onended = null;
    this.screenTrack = null;
    stopStream(this.state.screenStream);
    this.update({
      status: 'ended',
      localStream: null,
      screenSharing: false,
      screenStream: null,
      effectStream: null,
      background: NO_BACKGROUND,
      backgroundStatus: BACKGROUND_OFF,
      chat: [],
      notes: [],
      sharingTranscript: false,
      transcriptSharers: [],
    });
  }
}
