import type { ClientMessage } from '@meetlocal/shared';

export type PeerState = 'connecting' | 'connected' | 'reconnecting' | 'failed' | 'closed';

/** Outgoing ICE candidate in the signaling protocol's shape (candidate string is required). */
export type OutgoingIceCandidate = Extract<ClientMessage, { type: 'ice-candidate' }>['candidate'];

export interface PeerCallbacks {
  onLocalDescription(description: { type: 'offer' | 'answer'; sdp: string }): void;
  onIceCandidate(candidate: OutgoingIceCandidate): void;
  onRemoteStream(stream: MediaStream): void;
  onStateChange(state: PeerState): void;
}

export interface PeerOptions {
  iceServers: RTCIceServer[];
  localStream: MediaStream | null;
  /** The offerer creates offers (including ICE restarts); the answerer only answers. */
  isOfferer: boolean;
}

/** Narrow interface the rest of the app depends on (lets tests substitute a fake). */
export interface PeerLike {
  createOffer(): Promise<void>;
  handleOffer(description: RTCSessionDescriptionInit): Promise<void>;
  handleAnswer(description: RTCSessionDescriptionInit): Promise<void>;
  handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  /** Swaps the outgoing video/audio track without renegotiating. `null` stops sending that kind. */
  replaceVideoTrack(track: MediaStreamTrack | null): Promise<void>;
  replaceAudioTrack(track: MediaStreamTrack | null): Promise<void>;
  close(): void;
}

const MAX_RESTART_ATTEMPTS = 2;
const DISCONNECT_GRACE_MS = 4000;

/**
 * Wraps one RTCPeerConnection for a one-to-one call.
 *
 * - Signaling is handled by the caller; this class only produces and consumes descriptions
 *   and candidates.
 * - ICE candidates that arrive before the remote description is set are queued.
 * - The offerer retries with an ICE restart when the connection fails or stays disconnected.
 * - `close()` removes handlers and closes the connection. It does not stop local tracks;
 *   the caller owns the local stream.
 */
export class PeerSession implements PeerLike {
  private readonly pc: RTCPeerConnection;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private remoteDescriptionSet = false;
  private closed = false;
  private restartAttempts = 0;
  private everConnected = false;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly senders: { audio: RTCRtpSender | null; video: RTCRtpSender | null } = { audio: null, video: null };

  constructor(
    private readonly options: PeerOptions,
    private readonly callbacks: PeerCallbacks,
    createConnection: (config: RTCConfiguration) => RTCPeerConnection = (config) => new RTCPeerConnection(config),
  ) {
    this.pc = createConnection({ iceServers: options.iceServers });

    this.pc.onicecandidate = (event) => {
      const candidate = event.candidate;
      if (!candidate) return;
      callbacks.onIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment,
      });
    };

    this.pc.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      callbacks.onRemoteStream(stream);
    };

    this.pc.onconnectionstatechange = () => this.handleConnectionState();

    this.addLocalMedia();
  }

  /**
   * Sends our local tracks. For a kind we have no track for, a send-and-receive transceiver with no
   * track is added: we can still receive, and a track (screen share, a camera plugged in later) can be
   * attached afterwards with `replaceTrack` without renegotiating.
   */
  private addLocalMedia(): void {
    const stream = this.options.localStream;
    for (const kind of ['audio', 'video'] as const) {
      const track = stream ? (kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks())[0] : undefined;
      if (track && stream) {
        this.senders[kind] = this.pc.addTrack(track, stream);
      } else {
        this.senders[kind] = this.pc.addTransceiver(kind, { direction: 'sendrecv' }).sender;
      }
    }
  }

  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.replaceTrack('video', track);
  }

  async replaceAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.replaceTrack('audio', track);
  }

  private async replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null): Promise<void> {
    if (this.closed) return;
    const sender = this.senders[kind];
    if (!sender) throw new Error(`No ${kind} sender to replace`);
    await sender.replaceTrack(track);
  }

  async createOffer(): Promise<void> {
    await this.negotiate(false);
  }

  private async negotiate(iceRestart: boolean): Promise<void> {
    if (this.closed) return;
    const offer = await this.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
    if (this.closed) return;
    await this.pc.setLocalDescription(offer);
    const sdp = this.pc.localDescription?.sdp ?? offer.sdp;
    if (!sdp) throw new Error('Offer has no SDP');
    this.callbacks.onLocalDescription({ type: 'offer', sdp });
  }

  async handleOffer(description: RTCSessionDescriptionInit): Promise<void> {
    if (this.closed) return;
    if (this.options.isOfferer) {
      console.warn('Ignoring unexpected offer received by the offerer');
      return;
    }
    await this.pc.setRemoteDescription(description);
    await this.markRemoteDescriptionSet();
    const answer = await this.pc.createAnswer();
    if (this.closed) return;
    await this.pc.setLocalDescription(answer);
    const sdp = this.pc.localDescription?.sdp ?? answer.sdp;
    if (!sdp) throw new Error('Answer has no SDP');
    this.callbacks.onLocalDescription({ type: 'answer', sdp });
  }

  async handleAnswer(description: RTCSessionDescriptionInit): Promise<void> {
    if (this.closed) return;
    await this.pc.setRemoteDescription(description);
    await this.markRemoteDescriptionSet();
  }

  async handleIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (this.closed) return;
    if (!this.remoteDescriptionSet) {
      this.pendingCandidates.push(candidate);
      return;
    }
    await this.pc.addIceCandidate(candidate);
  }

  private async markRemoteDescriptionSet(): Promise<void> {
    this.remoteDescriptionSet = true;
    const queued = this.pendingCandidates;
    this.pendingCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch (error) {
        // One bad candidate must not abort the others.
        console.warn('Failed to add queued ICE candidate', error);
      }
    }
  }

  private handleConnectionState(): void {
    if (this.closed) return;
    clearTimeout(this.disconnectTimer);

    switch (this.pc.connectionState) {
      case 'connecting':
        this.callbacks.onStateChange(this.everConnected ? 'reconnecting' : 'connecting');
        break;
      case 'connected':
        this.everConnected = true;
        this.restartAttempts = 0;
        this.callbacks.onStateChange('connected');
        break;
      case 'disconnected':
        // Often transient; give the browser a moment to recover before restarting ICE.
        this.callbacks.onStateChange('reconnecting');
        this.disconnectTimer = setTimeout(() => {
          if (!this.closed && this.pc.connectionState === 'disconnected') void this.tryRestart();
        }, DISCONNECT_GRACE_MS);
        break;
      case 'failed':
        void this.tryRestart();
        break;
      case 'closed':
        break;
      default:
        break;
    }
  }

  private async tryRestart(): Promise<void> {
    if (this.closed) return;
    if (!this.options.isOfferer || this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      // The answerer cannot start negotiation; it reports failure and waits for a new offer.
      if (this.pc.connectionState === 'failed' || this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
        this.callbacks.onStateChange('failed');
      }
      return;
    }
    this.restartAttempts += 1;
    this.callbacks.onStateChange('reconnecting');
    try {
      await this.negotiate(true);
    } catch (error) {
      console.warn('ICE restart failed', error);
      this.callbacks.onStateChange('failed');
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.disconnectTimer);
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pendingCandidates = [];
    this.pc.close();
  }
}
