import { useAudioLevel } from '../../features/media/audioLevel';
import { supportsSpeakerSelection, type DeviceInfo } from '../../features/media/deviceManager';
import { useDevices } from '../../features/media/useDevices';
import { LevelMeter } from './LevelMeter';

interface DevicePanelProps {
  localStream: MediaStream | null;
  cameraId: string | null;
  microphoneId: string | null;
  speakerId: string;
  onSelectCamera: (id: string) => void;
  onSelectMicrophone: (id: string) => void;
  onSelectSpeaker: (id: string) => void;
}

function DeviceSelect(props: {
  id: string;
  label: string;
  devices: DeviceInfo[];
  value: string;
  onChange: (id: string) => void;
  emptyText: string;
}) {
  const { id, label, devices, value, onChange, emptyText } = props;
  return (
    <div className="form">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="input"
        value={value}
        disabled={devices.length === 0}
        onChange={(event) => onChange(event.target.value)}
      >
        {devices.length === 0 ? <option value="">{emptyText}</option> : null}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function DevicePanel(p: DevicePanelProps) {
  const { devices } = useDevices(p.localStream);
  const level = useAudioLevel(p.localStream);
  const speakerSupported = supportsSpeakerSelection();
  return (
    <div className="device-panel">
      <DeviceSelect
        id="device-camera"
        label="Camera"
        devices={devices.cameras}
        value={p.cameraId ?? ''}
        onChange={p.onSelectCamera}
        emptyText="No camera found"
      />
      <DeviceSelect
        id="device-microphone"
        label="Microphone"
        devices={devices.microphones}
        value={p.microphoneId ?? ''}
        onChange={p.onSelectMicrophone}
        emptyText="No microphone found"
      />
      <LevelMeter level={level} label="Microphone level" />
      {speakerSupported ? (
        <DeviceSelect
          id="device-speaker"
          label="Speaker"
          devices={devices.speakers}
          value={p.speakerId}
          onChange={p.onSelectSpeaker}
          emptyText="No speaker found"
        />
      ) : (
        <p className="muted small">Your browser does not support choosing a speaker. It uses the system default.</p>
      )}
      {!devices.labelsAvailable && (devices.cameras.length > 0 || devices.microphones.length > 0) ? (
        <p className="muted small">Device names appear once camera or microphone access is allowed.</p>
      ) : null}
    </div>
  );
}
