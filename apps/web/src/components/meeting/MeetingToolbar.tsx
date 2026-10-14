import {
  MessageSquare,
  Blend,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  NotebookPen,
  PhoneOff,
  ScanFace,
  Settings2,
  Sparkles,
  Subtitles,
  Users,
  Video,
  VideoOff,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface ToolbarButtonProps {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
  /** Toggle state for accessibility (true = the feature is currently off/muted). */
  pressed?: boolean;
  /** Highlighted because a feature is on (screen sharing, open panel). */
  active?: boolean;
  badge?: number;
}

function ToolbarButton({
  label,
  icon,
  onClick,
  disabled,
  disabledReason,
  danger,
  pressed,
  active,
  badge,
}: ToolbarButtonProps) {
  const classes = ['toolbar__btn'];
  if (danger) classes.push('toolbar__btn--danger');
  if (pressed) classes.push('toolbar__btn--off');
  if (active) classes.push('toolbar__btn--active');
  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={pressed}
      title={disabled && disabledReason ? `${label}: ${disabledReason}` : label}
    >
      {icon}
      <span className="toolbar__label">{label}</span>
      {badge ? (
        <span className="toolbar__badge" aria-hidden="true">
          {badge > 9 ? '9+' : badge}
        </span>
      ) : null}
    </button>
  );
}

interface MeetingToolbarProps {
  micEnabled: boolean;
  cameraEnabled: boolean;
  hasMic: boolean;
  hasCamera: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  onLeave: () => void;
  screenSharing: boolean;
  screenShareSupported: boolean;
  onToggleScreenShare: () => void;
  openPanel: PanelName | null;
  onTogglePanel: (panel: PanelName) => void;
  unreadChat: number;
  /** Transcription is currently listening (shown on the button). */
  transcribing?: boolean;
  /** A background effect is on. */
  backgroundOn?: boolean;
  /** You are sharing your transcript lines with the meeting. */
  sharingNotes?: boolean;
  /** The camera check is running. */
  cameraCheckOn?: boolean;
}

export type PanelName = 'chat' | 'participants' | 'devices' | 'transcript' | 'notes' | 'background' | 'assistant' | 'camera';

export function MeetingToolbar({
  micEnabled,
  cameraEnabled,
  hasMic,
  hasCamera,
  onToggleMic,
  onToggleCamera,
  onLeave,
  screenSharing,
  screenShareSupported,
  onToggleScreenShare,
  openPanel,
  onTogglePanel,
  unreadChat,
  transcribing = false,
  sharingNotes = false,
  backgroundOn = false,
  cameraCheckOn = false,
}: MeetingToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Meeting controls">
      <ToolbarButton
        label={micEnabled ? 'Mute' : 'Unmute'}
        icon={micEnabled ? <Mic size={20} aria-hidden="true" /> : <MicOff size={20} aria-hidden="true" />}
        onClick={onToggleMic}
        disabled={!hasMic}
        disabledReason="no microphone available"
        pressed={hasMic ? !micEnabled : undefined}
      />
      <ToolbarButton
        label={cameraEnabled ? 'Stop video' : 'Start video'}
        icon={cameraEnabled ? <Video size={20} aria-hidden="true" /> : <VideoOff size={20} aria-hidden="true" />}
        onClick={onToggleCamera}
        disabled={!hasCamera}
        disabledReason="no camera available"
        pressed={hasCamera ? !cameraEnabled : undefined}
      />
      <ToolbarButton
        label={screenSharing ? 'Stop sharing' : 'Share screen'}
        icon={screenSharing ? <MonitorOff size={20} aria-hidden="true" /> : <MonitorUp size={20} aria-hidden="true" />}
        onClick={onToggleScreenShare}
        disabled={!screenShareSupported}
        disabledReason="your browser does not support screen sharing"
        active={screenSharing}
      />
      <ToolbarButton
        label="Chat"
        icon={<MessageSquare size={20} aria-hidden="true" />}
        onClick={() => onTogglePanel('chat')}
        active={openPanel === 'chat'}
        badge={unreadChat}
      />
      <ToolbarButton
        label="People"
        icon={<Users size={20} aria-hidden="true" />}
        onClick={() => onTogglePanel('participants')}
        active={openPanel === 'participants'}
      />
      <ToolbarButton
        label="Transcript"
        icon={<Subtitles size={20} aria-hidden="true" />}
        onClick={() => onTogglePanel('transcript')}
        active={openPanel === 'transcript' || transcribing}
      />
      <ToolbarButton
        label="Background"
        icon={<Blend size={20} aria-hidden="true" />}
        onClick={() => onTogglePanel('background')}
        active={openPanel === 'background' || backgroundOn}
        disabled={!hasCamera}
        disabledReason="turn on a camera first"
      />
      <ToolbarButton
        label="Notes"
        icon={<NotebookPen size={20} aria-hidden="true" />}
        onClick={() => onTogglePanel('notes')}
        active={openPanel === 'notes' || sharingNotes}
      />
      <ToolbarButton
        label="Assistant"
        icon={<Sparkles size={20} aria-hidden="true" />}
        onClick={() => onTogglePanel('assistant')}
        active={openPanel === 'assistant'}
      />
      <ToolbarButton
        label="Camera check"
        icon={<ScanFace size={20} aria-hidden="true" />}
        onClick={() => onTogglePanel('camera')}
        active={openPanel === 'camera' || cameraCheckOn}
      />
      <ToolbarButton
        label="Devices"
        icon={<Settings2 size={20} aria-hidden="true" />}
        onClick={() => onTogglePanel('devices')}
        active={openPanel === 'devices'}
      />
      <ToolbarButton label="Leave" icon={<PhoneOff size={20} aria-hidden="true" />} onClick={onLeave} danger />
    </div>
  );
}
