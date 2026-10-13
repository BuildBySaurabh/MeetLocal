import { findPreset, type BackgroundMode } from './background.types';
import type { PersonMask } from './personMask';
import type { PersonSegmenter } from './personSegmenter';
import { SegmenterModelMissingError } from './personSegmenter';

export type ProcessorEvent =
  | { type: 'ready' }
  | { type: 'unavailable'; message: string };

export interface BackgroundProcessorLike {
  /** Starts processing `source` and returns the processed video track to send instead. */
  start(source: MediaStreamTrack, mode: BackgroundMode, onEvent: (event: ProcessorEvent) => void): MediaStreamTrack;
  setMode(mode: BackgroundMode): void;
  /** Switches to another camera without changing the output track. */
  setSource(source: MediaStreamTrack): void;
  stop(): void;
}

const MAX_WIDTH = 960;
const FRAME_MS = 1000 / 24;

/**
 * Draws your camera picture onto a canvas with the background blurred or replaced, and exposes the
 * canvas as a video track. Everything runs on this device. Until the segmentation model is ready,
 * and whenever it fails, the plain camera picture is drawn so the video never goes blank.
 *
 * Note: browsers slow timers in background tabs, so the effect can stutter when the tab is hidden.
 */
export class BackgroundProcessor implements BackgroundProcessorLike {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private person: HTMLCanvasElement | null = null;
  private small: HTMLCanvasElement | null = null;
  private maskCanvas: HTMLCanvasElement | null = null;
  private video: HTMLVideoElement | null = null;
  private source: MediaStreamTrack | null = null;
  private mode: BackgroundMode = { kind: 'none' };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private output: MediaStreamTrack | null = null;
  private segmenterReady = false;
  private stopped = false;
  private lastMask: PersonMask | null = null;
  private failures = 0;

  constructor(
    private readonly createSegmenter: () => PersonSegmenter,
    private readonly now: () => number = () => performance.now(),
  ) {}

  start(source: MediaStreamTrack, mode: BackgroundMode, onEvent: (event: ProcessorEvent) => void): MediaStreamTrack {
    this.mode = mode;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.person = document.createElement('canvas');
    this.small = document.createElement('canvas');
    this.maskCanvas = document.createElement('canvas');
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.attachSource(source);

    const segmenter = this.createSegmenter();
    segmenter
      .load()
      .then(() => {
        if (this.stopped) {
          segmenter.dispose();
          return;
        }
        this.segmenter = segmenter;
        this.segmenterReady = true;
        onEvent({ type: 'ready' });
      })
      .catch((error: unknown) => {
        segmenter.dispose();
        if (this.stopped) return;
        onEvent({
          type: 'unavailable',
          message:
            error instanceof SegmenterModelMissingError
              ? 'The background model is not on this device. Run "npm run fetch:segmenter-model" once, then reload. See docs/LOCAL_AI.md.'
              : 'The background effect could not start on this device.',
        });
      });

    this.output = this.canvas.captureStream(24).getVideoTracks()[0] ?? null;
    if (!this.output) throw new Error('This browser cannot capture video from a canvas.');
    this.schedule();
    return this.output;
  }

  private segmenter: PersonSegmenter | null = null;

  private attachSource(source: MediaStreamTrack): void {
    this.source = source;
    if (!this.video) return;
    this.video.srcObject = new MediaStream([source]);
    void this.video.play().catch(() => undefined);
  }

  setMode(mode: BackgroundMode): void {
    this.mode = mode;
  }

  setSource(source: MediaStreamTrack): void {
    this.lastMask = null;
    this.attachSource(source);
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.output?.stop();
    this.output = null;
    this.segmenter?.dispose();
    this.segmenter = null;
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    this.canvas = this.ctx = this.person = this.small = this.maskCanvas = null;
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      try {
        this.drawFrame();
      } catch (error) {
        console.warn('Background frame failed', error);
      }
      this.schedule();
    }, FRAME_MS);
  }

  /** Renders one frame (also called directly by tests). */
  drawFrame(): void {
    const { video, canvas, ctx } = this;
    if (!video || !canvas || !ctx || video.readyState < 2 || video.videoWidth === 0) return;
    // A switched-off camera sends black; skip the expensive work.
    if (this.source && !this.source.enabled) {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const scale = Math.min(1, MAX_WIDTH / video.videoWidth);
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    if (this.mode.kind === 'none' || !this.segmenterReady || !this.segmenter) {
      ctx.drawImage(video, 0, 0, w, h);
      return;
    }

    let mask: PersonMask | null = null;
    try {
      mask = this.segmenter.segment(video, this.now());
      this.failures = 0;
    } catch (error) {
      this.failures += 1;
      if (this.failures === 1) console.warn('Segmentation failed', error);
    }
    mask ??= this.lastMask;
    if (!mask) {
      ctx.drawImage(video, 0, 0, w, h);
      return;
    }
    this.lastMask = mask;
    this.compose(video, mask, w, h);
  }

  private compose(video: HTMLVideoElement, mask: PersonMask, w: number, h: number): void {
    const ctx = this.ctx!;
    const person = this.person!;
    const small = this.small!;
    const maskCanvas = this.maskCanvas!;

    // 1. Background layer.
    if (this.mode.kind === 'blur') {
      // Down-scale then up-scale with smoothing: a cheap blur that works in every browser.
      const divisor = this.mode.strength === 'strong' ? 14 : 7;
      small.width = Math.max(2, Math.round(w / divisor));
      small.height = Math.max(2, Math.round(h / divisor));
      const sctx = small.getContext('2d')!;
      sctx.imageSmoothingEnabled = true;
      sctx.drawImage(video, 0, 0, small.width, small.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(small, 0, 0, w, h);
    } else if (this.mode.kind === 'minimal') {
      const preset = findPreset(this.mode.preset);
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, preset.top);
      gradient.addColorStop(1, preset.bottom);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);
    }

    // 2. The person, cut out with the mask.
    person.width = w;
    person.height = h;
    const pctx = person.getContext('2d')!;
    pctx.globalCompositeOperation = 'source-over';
    pctx.clearRect(0, 0, w, h);
    pctx.drawImage(video, 0, 0, w, h);

    maskCanvas.width = mask.width;
    maskCanvas.height = mask.height;
    const mctx = maskCanvas.getContext('2d')!;
    const image = mctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < mask.alpha.length; i += 1) image.data[i * 4 + 3] = mask.alpha[i]!;
    mctx.putImageData(image, 0, 0);

    pctx.globalCompositeOperation = 'destination-in';
    pctx.imageSmoothingEnabled = true; // smooth scaling softens the cut-out edge
    pctx.drawImage(maskCanvas, 0, 0, w, h);
    pctx.globalCompositeOperation = 'source-over';

    ctx.drawImage(person, 0, 0, w, h);
  }
}
