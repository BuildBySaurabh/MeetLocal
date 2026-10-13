# WebRTC flow (one-to-one and small groups)

Implemented in Phase 2. Code: `features/media`, `features/signaling`, `features/webrtc`, `features/rooms/meetingSession.ts`.

## Roles

The participant who is **already in the room** is the *offerer*; the **newcomer** is the *answerer*.
Only the offerer creates offers (including ICE restarts), so offers never collide.

## Sequence

```
Alice (creator)            Signaling server              Bob (joiner)
   │  join(create) ───────────►│                              │
   │◄──────── joined (no peers)│                              │
   │  [waiting]                │◄──────────── join(join) ─────│
   │◄── participant-joined(Bob)│──── joined (peers: Alice) ──►│
   │  createOffer()            │                    [wait for offer]
   │  offer ──────────────────►│──── offer(from Alice) ──────►│ setRemote, createAnswer
   │◄── answer(from Bob) ──────│◄───────────── answer ────────│
   │◄══ ice-candidate ═════════╪═══════ ice-candidate ═══════►│  (both directions)
   │◄═══════════ audio/video, direct when ICE succeeds ═══════►│
```

1. Media is requested by the page only after a user action (preview button, or joining the meeting).
2. Each page load uses a fresh random participant ID (avoids duplicate-ID clashes after a refresh).
3. ICE candidates that arrive before the remote description is set are queued, then applied in order.
4. If a participant has no camera/microphone (or denied access), receive-only transceivers are added so
   they can still see and hear the other person.

## Connection states shown to the user

| UI status | Meaning |
| --- | --- |
| Starting… | Opening devices and the signaling connection |
| Waiting for others to join | In the room alone |
| Connecting… | Negotiating with the other participant |
| Connected | Peer connection reports `connected` (never assumed) |
| Reconnecting… | Peer `disconnected`, ICE restart in progress, or signaling being re-established |
| Connection failed | Unrecoverable; an explanation and "Try again" are shown |

## Recovery behaviour

- **Peer `disconnected`**: shown as Reconnecting; the offerer restarts ICE if it has not recovered after 4 s.
- **Peer `failed`**: the offerer retries an ICE restart up to 2 times, then reports failure with an explanation
  that a TURN relay may be needed. The answerer reports failure and waits for a new offer.
- **Signaling socket drops**: the server removes us from the room, so the peer connection is torn down.
  The client reconnects (1 s, 2 s, 4 s backoff, 3 attempts), rejoins with a fresh participant ID, and the
  other participant renegotiates. After the last attempt a clear "cannot reach the meeting server" error is shown.
- **Other participant leaves**: peer closed, status returns to Waiting.
- **Leaving**: `leave` is sent, the socket and peer are closed, and every local track is stopped.

## Screen sharing and device switching (Phase 3)

Every peer connection starts with `sendrecv` transceivers for audio and video (a track-less one if that device is
missing). Switching camera/microphone or starting/stopping a screen share calls `RTCRtpSender.replaceTrack`, so
**no renegotiation is needed**. Stopping the share via the toolbar or the browser's own "Stop sharing" button
restores the camera. If a device disappears (`ended`), the session reports it and keeps the call going.
Chat and media-state travel over the signaling socket (`chat`, `media-state` messages; sender set by the server).

## Known limitations

- Mute/camera toggles disable the local track and send a `media-state` message so the other side shows a camera-off
  avatar. If the other side has not sent state yet, the tile follows whether video is arriving.
- Reloading the page while in a call is a leave followed by a rejoin; the peer reconnects.
- Up to 4 participants per room, as a full mesh: each pair negotiates separately, and for each pair the participant already in the room sends the offer. A newcomer receives the participant list in `joined` and answers every offer; existing participants offer when `participant-joined` arrives. Track changes (mute device switch, screen share) are applied to every peer. If one peer fails while others are alive the call continues with a notice; if all fail the call ends with the ICE error.
- STUN only by default. Peers behind symmetric NAT or strict firewalls may fail without a TURN relay.
- Using the app from another device on the LAN needs HTTPS (browsers block camera/microphone on plain HTTP
  except on `localhost`) and `ALLOWED_ORIGINS` set to that origin.
