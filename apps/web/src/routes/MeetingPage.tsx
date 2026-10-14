import { AlertTriangle, Info, Keyboard, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { CopyLinkButton } from '../components/meeting/CopyLinkButton';
import { BackgroundPanel } from '../components/background/BackgroundPanel';
import { NotesPanel } from '../components/notes/NotesPanel';
import { TranscriptPanel } from '../components/transcript/TranscriptPanel';
import { downloadTextFile } from '../services/download';
import { DEFAULT_MODEL } from '../features/transcription/transcriptionEngine';
import { useTranscription } from '../features/transcription/useTranscription';
import { useOwnSpeechRecorder } from '../features/notes/useOwnSpeechRecorder';
import { formatNotesMarkdown, formatNotesText } from '../features/notes/notesFormat';
import { findLanguage } from '../features/translation/languages';
import { useNoteTranslation } from '../features/translation/useNoteTranslation';
import { CameraCheckPanel } from '../components/eyetracking/CameraCheckPanel';
import { useEyeTracking } from '../features/eye-tracking/useEyeTracking';
import { AssistantPanel } from '../components/assistant/AssistantPanel';
import { useAssistant } from '../features/assistant/useAssistant';
import { ChatPanel } from '../components/meeting/ChatPanel';
import { DevicePanel } from '../components/meeting/DevicePanel';
import { MeetingToolbar, type PanelName } from '../components/meeting/MeetingToolbar';
import { ParticipantList, type ParticipantRow } from '../components/meeting/ParticipantList';
import { ShortcutsHelp } from '../components/meeting/ShortcutsHelp';
import { VideoTile } from '../components/meeting/VideoTile';
import { shortcutForEvent } from '../features/rooms/shortcuts';
import { formatDuration, useElapsed } from '../features/rooms/duration';
import type { SessionStatus } from '../features/rooms/meetingSession';
import { getShareUrl, isValidRoomId } from '../features/rooms/room.service';
import type { MeetingLocationState } from '../features/rooms/room.types';
import { useMeetingSession } from '../features/rooms/useRoom';
import { loadDevicePreferences, loadDisplayName, saveDevicePreference } from '../services/preferences';

interface MeetingRouteState extends MeetingLocationState {
  displayName?: string;
}

const PANEL_TITLE: Record<PanelName, string> = {
  chat: 'Chat',
  participants: 'People',
  devices: 'Devices',
  transcript: 'Transcript',
  notes: 'Meeting notes',
  background: 'Background',
  assistant: 'Assistant',
  camera: 'Camera check',
};

const PANEL_BUTTON_LABEL: Record<PanelName, string> = {
  chat: 'Chat',
  participants: 'People',
  devices: 'Devices',
  transcript: 'Transcript',
  notes: 'Notes',
  background: 'Background',
  assistant: 'Assistant',
  camera: 'Camera check',
};

const TAB_PANELS: readonly PanelName[] = ['chat', 'notes', 'transcript', 'assistant'];
const TAB_LABEL: Partial<Record<PanelName, string>> = {
  chat: 'Chat',
  notes: 'Notes',
  transcript: 'Transcript',
  assistant: 'AI Assistant',
};

const STATUS_LABEL: Record<SessionStatus, string> = {
  starting: 'Starting…',
  waiting: 'Waiting for others to join',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  failed: 'Connection failed',
  ended: 'Left the meeting',
};

const STATUS_DOT: Record<SessionStatus, string> = {
  starting: 'idle',
  waiting: 'idle',
  connecting: 'idle',
  connected: 'ok',
  reconnecting: 'idle',
  failed: 'bad',
  ended: 'idle',
};

export function MeetingPage() {
  const { roomId = '' } = useParams();
  const location = useLocation();
  const routeState = location.state as MeetingRouteState | null;

  if (!isValidRoomId(roomId)) return <Navigate to="/" replace />;

  const displayName = routeState?.displayName ?? loadDisplayName();
  // Arriving without a name (e.g. a pasted /meeting URL) goes through the join page first.
  if (!displayName) return <Navigate to={`/join/${roomId}`} replace />;

  return <ActiveMeeting roomId={roomId} displayName={displayName} intent={routeState?.intent ?? 'join'} />;
}

interface ActiveMeetingProps {
  roomId: string;
  displayName: string;
  intent: 'create' | 'join';
}

function ActiveMeeting({ roomId, displayName, intent }: ActiveMeetingProps) {
  const navigate = useNavigate();
  const session = useMeetingSession({ roomId, displayName, intent });
  const { state, toggleMic, toggleCamera, leave, retry } = session;
  const cameraCheck = useEyeTracking(state?.localStream ?? null, !!state?.cameraEnabled);
  const cameraChecking = cameraCheck.state.status === 'running' || cameraCheck.state.status === 'camera-off';
  const transcription = useTranscription(roomId, state?.localStream ?? null);
  const transcribing = transcription.state.status === 'listening';
  const notes = state?.notes ?? [];
  const translation = useNoteTranslation(notes);
  const [openPanel, setOpenPanel] = useState<PanelName | null>(null);
  // The local model server is only contacted once the Assistant panel has been opened.
  const [assistantOpened, setAssistantOpened] = useState(false);
  const assistant = useAssistant(roomId, assistantOpened);
  const [speakerId, setSpeakerId] = useState(() => loadDevicePreferences().speakerId ?? '');
  const [readCount, setReadCount] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const elapsed = useElapsed(state?.joinedAt ?? null);
  const chatCount = state?.chat.length ?? 0;
  const unreadChat = openPanel === 'chat' ? 0 : Math.max(0, chatCount - readCount);

  // Own transcript lines go into the shared notes (and to others only if you chose to share).
  useOwnSpeechRecorder(transcription.state, session.recordOwnSpeech);

  // Sharing makes no sense once your own transcription is no longer running.
  const transcriptionRunning = ['listening', 'paused', 'loading-model'].includes(transcription.state.status);
  const sharingTranscript = !!state?.sharingTranscript;
  useEffect(() => {
    if (sharingTranscript && !transcriptionRunning) session.setTranscriptSharing(false);
  }, [sharingTranscript, transcriptionRunning, session]);

  function downloadNotes(format: 'txt' | 'md') {
    const language = translation.state.target;
    const options = {
      translations: translation.state.translations,
      translationLanguage: findLanguage(language?.code)?.name,
    };
    const day = new Date().toISOString().slice(0, 10);
    downloadTextFile(
      `meetlocal-notes-${day}.${format}`,
      format === 'md' ? formatNotesMarkdown(notes, options) : formatNotesText(notes, options),
      format === 'md' ? 'text/markdown' : 'text/plain',
    );
  }

  // Everything in the chat is read while the chat panel is open.
  useEffect(() => {
    if (openPanel === 'chat') setReadCount(chatCount);
  }, [openPanel, chatCount]);

  // Escape closes the side panel and returns focus to the button that opened it.
  useEffect(() => {
    if (!openPanel) return;
    const panel = openPanel;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenPanel(null);
      const label = PANEL_BUTTON_LABEL[panel];
      requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(`.toolbar button[aria-label="${label}"]`)?.focus();
      });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [openPanel]);

  // On narrow screens the panel opens below the video; bring it into view.
  useEffect(() => {
    if (!openPanel) return;
    document.querySelector('.side-panel')?.scrollIntoView?.({ block: 'nearest' });
  }, [openPanel]);

  // Single-key shortcuts. Handlers read the latest values through a ref so the listener is added once.
  const shortcutHandlers = useRef({
    toggleMic,
    toggleCamera,
    toggleScreenShare: () => {},
    togglePanel: (_panel: PanelName) => {},
  });
  useEffect(() => {
    shortcutHandlers.current = {
      toggleMic,
      toggleCamera,
      toggleScreenShare: state?.screenSharing ? session.stopScreenShare : session.startScreenShare,
      togglePanel,
    };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = shortcutForEvent(event);
      if (!action) return;
      const h = shortcutHandlers.current;
      event.preventDefault();
      switch (action.type) {
        case 'toggle-mic':
          h.toggleMic();
          break;
        case 'toggle-camera':
          h.toggleCamera();
          break;
        case 'toggle-screen-share':
          if (typeof navigator.mediaDevices?.getDisplayMedia === 'function') h.toggleScreenShare();
          break;
        case 'toggle-panel':
          h.togglePanel(action.panel);
          break;
        case 'show-help':
          setHelpOpen(true);
          break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function togglePanel(panel: PanelName) {
    if (panel === 'assistant') setAssistantOpened(true);
    setOpenPanel((current) => (current === panel ? null : panel));
  }

  function selectPanel(panel: PanelName) {
    if (panel === 'assistant') setAssistantOpened(true);
    setOpenPanel(panel);
  }

  function selectDevice(kind: 'camera' | 'microphone', id: string) {
    saveDevicePreference(kind === 'camera' ? 'cameraId' : 'microphoneId', id);
    if (kind === 'camera') session.selectCamera(id);
    else session.selectMicrophone(id);
  }

  function selectSpeaker(id: string) {
    saveDevicePreference('speakerId', id);
    setSpeakerId(id);
  }

  const closeHelp = useCallback(() => setHelpOpen(false), []);

  function handleLeave() {
    leave();
    navigate('/');
  }

  if (state?.status === 'failed' && state.error) {
    return (
      <main className="page page--center">
        <div className="card card--narrow" role="alert">
          <h1 className="card__title">
            <AlertTriangle size={18} aria-hidden="true" /> {state.error.title}
          </h1>
          <p>{state.error.message}</p>
          <p className="muted">{state.error.recovery}</p>
          <div className="stack-row">
            <button type="button" className="btn btn--primary" onClick={retry}>
              Try again
            </button>
            <Link to="/" className="btn btn--ghost">
              Back to home
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const status: SessionStatus = state?.status ?? 'starting';
  const remotes = state?.remotes ?? [];
  const hasRemote = remotes.length > 0;
  const screenSharing = !!state?.screenSharing;
  // While you share, the tile shows what others see (your screen); otherwise your camera.
  const localStream =
    screenSharing && state?.screenStream ? state.screenStream : (state?.effectStream ?? state?.localStream ?? null);
  const showLocalVideo = screenSharing ? !!state?.screenStream : !!state?.cameraEnabled && !!state.localStream;
  const screenShareSupported =
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
  const participants: ParticipantRow[] = [
    {
      id: 'local',
      name: displayName,
      isYou: true,
      micEnabled: state?.hasMic ? state.micEnabled : false,
      cameraEnabled: state?.hasCamera ? state.cameraEnabled : false,
      screenSharing,
    },
    ...remotes.map((r) => ({
      id: r.participant.id,
      name: r.participant.displayName,
      isYou: false,
      micEnabled: r.mediaState ? r.mediaState.micEnabled : null,
      cameraEnabled: r.mediaState ? r.mediaState.cameraEnabled : null,
      screenSharing: !!r.mediaState?.screenSharing,
    })),
  ];

  return (
    <div className="meeting">
      <header className="meeting__header">
        <h1 className="sr-only">MeetLocal meeting</h1>
        <Link to="/" className="brand brand--compact" aria-label="MeetLocal home" onClick={leave}>
          <span className="brand__name">MeetLocal</span>
        </Link>
        <div className="meeting__status" role="status">
          <span className={`status-dot status-dot--${STATUS_DOT[status]}`} aria-hidden="true" />
          {STATUS_LABEL[status]}
        </div>
        {cameraChecking ? (
          <span className="meeting__rec" role="status">
            Camera check on (only you see it)
          </span>
        ) : null}
        {transcribing ? (
          <span className="meeting__rec" role="status">
            Transcribing on this device
          </span>
        ) : null}
        {sharingTranscript ? (
          <span className="meeting__rec" role="status">
            Sharing your transcript with the meeting
          </span>
        ) : null}
        {elapsed !== null ? (
          <span className="meeting__timer" aria-label="Meeting duration">
            {formatDuration(elapsed)}
          </span>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost btn--sm kbd-hint"
          aria-label="Keyboard shortcuts"
          onClick={() => setHelpOpen(true)}
        >
          <Keyboard size={16} aria-hidden="true" />
        </button>
        <CopyLinkButton url={getShareUrl(roomId)} />
      </header>
      {helpOpen ? <ShortcutsHelp onClose={closeHelp} /> : null}

      {state?.mediaFailure ? (
        <div className="notice notice--warn" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>
            <p>
              <strong>{state.mediaFailure.message}</strong> You can still see and hear others, but they cannot see or
              hear you.
            </p>
            <p>{state.mediaFailure.recovery}</p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={retry}>
              Try camera and microphone again
            </button>
          </div>
        </div>
      ) : null}

      {state?.mediaNotice ? (
        <div className="notice" role="note">
          <Info size={16} aria-hidden="true" />
          <p>{state.mediaNotice}</p>
        </div>
      ) : null}

      {state?.notice ? (
        <div className={`notice${state.notice.kind === 'error' ? ' notice--warn' : ''}`} role="alert">
          <Info size={16} aria-hidden="true" />
          <p>{state.notice.text}</p>
          <button
            type="button"
            className="btn btn--ghost btn--sm notice__dismiss"
            aria-label="Dismiss message"
            onClick={session.dismissNotice}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="meeting__body">
        <main className="meeting__stage">
          <div className="video-grid" data-count={remotes.length + 1}>
            <VideoTile
              name={displayName}
              isLocal
              stream={localStream}
              showVideo={showLocalVideo}
              screenShare={screenSharing}
              placeholder={state?.hasCamera === false ? 'No camera' : state?.localStream ? 'Camera off' : undefined}
              micMuted={!!state?.hasMic && !state.micEnabled}
              cameraOff={!screenSharing && !!state?.hasCamera && !state.cameraEnabled}
            />
            {remotes.map((r) => {
              const ms = r.mediaState;
              const screen = !!ms?.screenSharing;
              // Without a media-state message yet, trust whether video is arriving.
              const showVideo = r.hasVideo && (ms ? ms.cameraEnabled || screen : true);
              return (
                <VideoTile
                  key={r.participant.id}
                  name={r.participant.displayName}
                  stream={r.stream}
                  showVideo={showVideo}
                  screenShare={screen}
                  sinkId={speakerId || undefined}
                  micMuted={ms ? !ms.micEnabled : false}
                  cameraOff={ms ? !ms.cameraEnabled && !screen : false}
                  placeholder={
                    r.connection === 'failed'
                      ? 'Could not connect'
                      : r.connection !== 'connected'
                        ? 'Connecting…'
                        : ms && !ms.cameraEnabled
                          ? 'Camera off'
                          : 'No video'
                  }
                />
              );
            })}
            {!hasRemote ? (
              <VideoTile name="Waiting for someone to join" stream={null} showVideo={false} placeholder="No one else is here yet" />
            ) : null}
          </div>
        </main>

        {openPanel ? (
          <aside className="side-panel" aria-label={PANEL_TITLE[openPanel]}>
            <div className="side-panel__header">
              <h2 className="side-panel__title">{PANEL_TITLE[openPanel]}</h2>
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                aria-label="Close panel"
                onClick={() => setOpenPanel(null)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            {TAB_PANELS.includes(openPanel) ? (
              <div role="tablist" aria-label="Meeting tools" className="panel-tabs">
                {TAB_PANELS.map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={name === openPanel}
                    className={`panel-tabs__tab${name === openPanel ? ' panel-tabs__tab--on' : ''}`}
                    onClick={() => selectPanel(name)}
                  >
                    {TAB_LABEL[name]}
                  </button>
                ))}
              </div>
            ) : null}
            {openPanel === 'chat' ? (
              <ChatPanel
                messages={state?.chat ?? []}
                canSend={hasRemote && status === 'connected'}
                onSend={session.sendChat}
              />
            ) : null}
            {openPanel === 'camera' ? (
              <CameraCheckPanel
                state={cameraCheck.state}
                hasCamera={!!state?.hasCamera}
                onStart={cameraCheck.start}
                onStop={cameraCheck.stop}
                onCalibrate={cameraCheck.calibrate}
              />
            ) : null}
            {openPanel === 'background' ? (
              <BackgroundPanel
                mode={state?.background ?? { kind: 'none' }}
                status={state?.backgroundStatus ?? { kind: 'off', message: null }}
                hasCamera={!!state?.hasCamera}
                onChange={session.setBackground}
              />
            ) : null}
            {openPanel === 'notes' ? (
              <NotesPanel
                notes={notes}
                sharerNames={(state?.transcriptSharers ?? []).map(
                  (id) => state?.remotes.find((r) => r.participant.id === id)?.participant.displayName ?? 'Participant',
                )}
                sharing={sharingTranscript}
                transcription={transcription.state}
                hasMic={!!state?.hasMic}
                connected={status === 'connected' || status === 'waiting'}
                translation={translation.state}
                onStartTranscription={transcription.start}
                onStopTranscription={transcription.stop}
                onToggleSharing={session.setTranscriptSharing}
                onSetLanguage={translation.setLanguage}
                onDownload={downloadNotes}
                onClear={session.clearNotes}
              />
            ) : null}
            {openPanel === 'assistant' ? (
              <AssistantPanel
                state={assistant.state}
                segments={transcription.state.segments}
                onRun={assistant.run}
                onCancel={assistant.cancel}
                onRefresh={assistant.refresh}
                onSetModel={assistant.setModel}
                onClearHistory={assistant.clearHistory}
              />
            ) : null}
            {openPanel === 'transcript' ? (
              <TranscriptPanel
                state={transcription.state}
                persistent={transcription.persistent}
                hasMic={!!state?.hasMic}
                micEnabled={!!state?.micEnabled}
                modelName={DEFAULT_MODEL.split('/').pop() ?? DEFAULT_MODEL}
                onStart={transcription.start}
                onPause={transcription.pause}
                onResume={transcription.resume}
                onStop={transcription.stop}
                onClear={transcription.clear}
                onExport={() =>
                  downloadTextFile(
                    `meetlocal-transcript-${new Date().toISOString().slice(0, 10)}.txt`,
                    transcription.exportText(),
                  )
                }
              />
            ) : null}
            {openPanel === 'participants' ? <ParticipantList participants={participants} /> : null}
            {openPanel === 'devices' ? (
              <DevicePanel
                localStream={state?.localStream ?? null}
                cameraId={state?.cameraId ?? null}
                microphoneId={state?.microphoneId ?? null}
                speakerId={speakerId}
                onSelectCamera={(id) => selectDevice('camera', id)}
                onSelectMicrophone={(id) => selectDevice('microphone', id)}
                onSelectSpeaker={selectSpeaker}
              />
            ) : null}
          </aside>
        ) : null}
      </div>

      <footer className="meeting__footer">
        <MeetingToolbar
          micEnabled={!!state?.micEnabled}
          cameraEnabled={!!state?.cameraEnabled}
          hasMic={!!state?.hasMic}
          hasCamera={!!state?.hasCamera}
          onToggleMic={toggleMic}
          onToggleCamera={toggleCamera}
          onLeave={handleLeave}
          screenSharing={screenSharing}
          screenShareSupported={screenShareSupported}
          onToggleScreenShare={screenSharing ? session.stopScreenShare : session.startScreenShare}
          openPanel={openPanel}
          onTogglePanel={togglePanel}
          unreadChat={unreadChat}
          transcribing={transcribing}
          sharingNotes={sharingTranscript}
          backgroundOn={state?.background.kind !== undefined && state.background.kind !== 'none'}
          cameraCheckOn={cameraChecking}
        />
      </footer>
    </div>
  );
}
