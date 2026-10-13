import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CameraCheckState } from '../../features/eye-tracking/gaze.types';
import { CameraCheckPanel } from './CameraCheckPanel';

afterEach(cleanup);

const base: CameraCheckState = { status: 'idle', failure: null, facePresent: false, metrics: null, calibrated: false };
const metrics = {
  yaw: 31,
  pitch: -8,
  roll: 2,
  eyeX: 0.7,
  eyeY: 0,
  box: { left: 0, top: 0, right: 1, bottom: 1 },
  centerX: 0.5,
  centerY: 0.5,
  size: 0.9,
  outsideFrame: true,
};

function renderPanel(state: Partial<CameraCheckState> = {}, props: { hasCamera?: boolean } = {}) {
  const h = { onStart: vi.fn(), onStop: vi.fn(), onCalibrate: vi.fn(() => true) };
  render(<CameraCheckPanel state={{ ...base, ...state }} hasCamera={props.hasCamera ?? true} {...h} />);
  return h;
}

describe('CameraCheckPanel', () => {
  it('states the limits and privacy before anything starts, and only starts on click', () => {
    const h = renderPanel();
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/Approximate camera feedback, for you only/);
    expect(text).toMatch(/does not measure attention, honesty, effort or ability/);
    expect(text).toMatch(/Nothing is recorded, saved or sent/);
    expect(h.onStart).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /turn on camera check/i }));
    expect(h.onStart).toHaveBeenCalled();
  });

  it('shows a missing-model failure with a retry', () => {
    const h = renderPanel({
      status: 'model-missing',
      failure: { message: 'The face model file is not installed.', recovery: 'Run npm run fetch:face-model' },
    });
    expect(screen.getByRole('alert').textContent).toMatch(/fetch:face-model/);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(h.onStart).toHaveBeenCalled();
  });

  it('shows approximate results with the word approximate, plus framing tips', () => {
    renderPanel({ status: 'running', facePresent: true, metrics });
    const results = screen.getByLabelText('Approximate results').textContent ?? '';
    expect(results).toMatch(/Turned toward your right/);
    expect(results).toMatch(/Toward your right/);
    expect(results).toMatch(/Partly outside the frame/);
    expect(screen.getByText(/Head turn \(approx\.\)/)).toBeTruthy();
    expect(screen.getByText(/move back a little/i)).toBeTruthy();
    expect(results).not.toMatch(/attention|honest|distract|cheat/i);
  });

  it('offers calibration only while running, and turn off while active', () => {
    const h = renderPanel({ status: 'running', facePresent: true, metrics });
    fireEvent.click(screen.getByRole('button', { name: /^calibrate/i }));
    expect(h.onCalibrate).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /turn off/i }));
    expect(h.onStop).toHaveBeenCalled();
  });

  it('explains when the camera is off or missing', () => {
    renderPanel({ status: 'camera-off' });
    expect(screen.getByText(/camera is off/i)).toBeTruthy();
    cleanup();
    renderPanel({}, { hasCamera: false });
    expect((screen.getByRole('button', { name: /turn on camera check/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
