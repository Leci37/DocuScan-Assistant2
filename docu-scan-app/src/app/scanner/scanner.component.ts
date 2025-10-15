import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Inject,
  Input,
  OnDestroy,
  Output,
  PLATFORM_ID,
  ViewChild,
} from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ScannerService } from './scanner.service';
import { DEFAULT_SCANNER_CONFIG, ScannerConfig } from './scanner.config';
import {
  CaptureAnimationPhase,
  CornerHistory,
  Point,
  QualityScores,
} from './models/corner.model';
import { ScanResult } from './models/scan-result.model';

interface FrameDimensions {
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
}

interface ColorRgb {
  r: number;
  g: number;
  b: number;
}

declare const cv: any;

@Component({
  selector: 'app-scanner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scanner.component.html',
  styleUrls: ['./scanner.component.css'],
})
export class ScannerComponent implements AfterViewInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;

  @Input() config: ScannerConfig = DEFAULT_SCANNER_CONFIG;
  @Output() documentCaptured = new EventEmitter<ScanResult>();

  score = 0;
  stabilityScore = 0;
  sharpnessScore = 0;
  lightingScore = 0;
  scoreColor = '#FF4444';

  isCountingDown = false;
  countdownOffset = 220;
  countdownSeconds = 3;

  isCapturing = false;
  captureComplete = false;
  flashActive = false;

  polygonOpacity = 0.25;
  private readonly cornerRadius = 8;

  private stream: MediaStream | null = null;
  private animationId: number | null = null;
  private processingCanvas: HTMLCanvasElement | null = null;
  private processingCtx: CanvasRenderingContext2D | null = null;
  private opencvLoaded = false;
  private frameIndex = 0;
  private frameSkipCounter = 0;

  private cornerHistory: CornerHistory[] = [];
  private readonly STABILITY_FRAMES = 7;
  private currentCorners: Point[] = [];

  private highScoreStartTime: number | null = null;
  readonly countdownCircumference = 2 * Math.PI * 35;

  private captureInProgress = false;
  private captureAnimationPhase: CaptureAnimationPhase = 'idle';
  private captureAnimationStart = 0;
  private captureTimers: number[] = [];

  private readonly baseColor: ColorRgb = { r: 255, g: 68, b: 68 };
  private targetColor: ColorRgb = { ...this.baseColor };
  private currentColor: ColorRgb = { ...this.baseColor };
  private audioContext?: AudioContext;

  constructor(
    @Inject(PLATFORM_ID) private readonly platformId: Object,
    private readonly scannerService: ScannerService,
  ) {}

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      await this.waitForOpenCV();
      await this.startCamera();
    } catch (error) {
      console.error(error);
      alert(
        'Unable to initialise the scanner. Please ensure camera permissions are granted and OpenCV.js is available.',
      );
    }
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  manualCapture(): void {
    void this.captureDocument();
  }

  private async waitForOpenCV(): Promise<void> {
    if (this.opencvLoaded) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        reject(new Error('OpenCV.js did not load within the expected time.'));
      }, 30000);

      const checkInterval = window.setInterval(() => {
        if (typeof cv !== 'undefined' && cv.Mat) {
          window.clearInterval(checkInterval);
          window.clearTimeout(timeout);
          this.opencvLoaded = true;
          resolve();
        }
      }, 100);
    });
  }

  private async startCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Media devices are not supported in this browser.');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    const video = this.videoElement.nativeElement;
    video.srcObject = this.stream;

    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => {
        void video.play();
        resolve();
      };
    });

    await new Promise((resolve) => setTimeout(resolve, 300));

    this.setupCanvases();
    this.startProcessingLoop();
  }

  private setupCanvases(): void {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    this.processingCanvas = document.createElement('canvas');
    const maxWidth = 640;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const processingWidth = Math.round(video.videoWidth * scale);
    const processingHeight = Math.round(video.videoHeight * scale);
    this.processingCanvas.width = processingWidth;
    this.processingCanvas.height = processingHeight;
    this.processingCtx = this.processingCanvas.getContext('2d', { willReadFrequently: true }) as
      | CanvasRenderingContext2D
      | null;

    this.countdownOffset = this.countdownCircumference;
    this.countdownSeconds = Math.ceil(this.config.captureDelay / 1000);
  }

  private startProcessingLoop(): void {
    const process = () => {
      try {
        this.processFrame();
      } catch (error) {
        console.error('Processing error', error);
      }
      this.animationId = requestAnimationFrame(process);
    };

    this.animationId = requestAnimationFrame(process);
  }

  private processFrame(): void {
    const video = this.videoElement.nativeElement;
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      return;
    }

    if (!this.processingCtx || !this.processingCanvas) {
      return;
    }

    this.frameSkipCounter = (this.frameSkipCounter + 1) % this.config.frameProcessingRate;
    if (this.frameSkipCounter !== 0) {
      return;
    }

    const dims = this.drawFrameToProcessingCanvas();
    if (!dims) {
      return;
    }

    const imageData = this.processingCtx.getImageData(
      0,
      0,
      this.processingCanvas.width,
      this.processingCanvas.height,
    );
    const frameMat = cv.matFromImageData(imageData);

    try {
      const detection = this.scannerService.detectDocument(frameMat, this.config);
      let scaledCorners: Point[] = [];
      if (detection?.corners) {
        scaledCorners = detection.corners.map((corner) => ({
          x: corner.x * dims.scaleX,
          y: corner.y * dims.scaleY,
        }));
      }

      const stability = this.computeStability(scaledCorners);
      const sharpness = this.scannerService.calculateSharpness(frameMat);
      const lighting = this.scannerService.calculateLightingQuality(frameMat);

      const overall = this.calculateOverallScore(stability, sharpness, lighting, scaledCorners.length === 4);
      this.updateScores({
        overall,
        stability,
        sharpness,
        lighting,
      });

      this.updateColorTargets(overall, scaledCorners.length === 4);
      this.animateColor();
      this.drawOverlay(scaledCorners);

      if (this.config.autoCapture && scaledCorners.length === 4 && !this.captureInProgress) {
        this.handleAutoCapture(overall);
      } else {
        this.resetCountdown();
        this.highScoreStartTime = null;
      }

      if (scaledCorners.length === 4) {
        this.currentCorners = scaledCorners;
      } else {
        this.currentCorners = [];
        this.cornerHistory = [];
      }
    } finally {
      frameMat.delete();
    }
  }

  private drawFrameToProcessingCanvas(): FrameDimensions | null {
    const video = this.videoElement.nativeElement;
    if (!this.processingCanvas || !this.processingCtx) {
      return null;
    }

    this.processingCtx.drawImage(
      video,
      0,
      0,
      this.processingCanvas.width,
      this.processingCanvas.height,
    );

    return {
      width: this.processingCanvas.width,
      height: this.processingCanvas.height,
      scaleX: video.videoWidth / this.processingCanvas.width,
      scaleY: video.videoHeight / this.processingCanvas.height,
    };
  }

  private computeStability(corners: Point[]): number {
    if (corners.length !== 4) {
      this.cornerHistory = [];
      return 0;
    }

    this.frameIndex += 1;
    this.cornerHistory.push({
      frame: this.frameIndex,
      corners: corners.map((c) => ({ ...c })),
      timestamp: Date.now(),
    });

    if (this.cornerHistory.length > this.STABILITY_FRAMES) {
      this.cornerHistory.shift();
    }

    if (this.cornerHistory.length < 2) {
      return 0;
    }

    let totalMovement = 0;
    let comparisons = 0;

    for (let i = 1; i < this.cornerHistory.length; i++) {
      const prev = this.cornerHistory[i - 1];
      const current = this.cornerHistory[i];
      for (let j = 0; j < 4; j++) {
        const dx = current.corners[j].x - prev.corners[j].x;
        const dy = current.corners[j].y - prev.corners[j].y;
        totalMovement += Math.sqrt(dx * dx + dy * dy);
        comparisons++;
      }
    }

    const avgMovement = totalMovement / Math.max(comparisons, 1);

    if (avgMovement <= 5) {
      return 100;
    }
    if (avgMovement >= 50) {
      return 0;
    }

    const ratio = (avgMovement - 5) / (50 - 5);
    return Math.max(0, Math.min(100, Math.round(100 - ratio * 100)));
  }

  private calculateOverallScore(
    stability: number,
    sharpness: number,
    lighting: number,
    hasDetection: boolean,
  ): number {
    const stabilityScore = hasDetection ? stability * 0.4 : 0;
    const sharpnessScore = sharpness * 0.35;
    const lightingScore = lighting * 0.25;
    return Math.round(stabilityScore + sharpnessScore + lightingScore);
  }

  private updateScores(scores: QualityScores): void {
    this.score = scores.overall;
    this.stabilityScore = Math.round(scores.stability);
    this.sharpnessScore = Math.round(scores.sharpness);
    this.lightingScore = Math.round(scores.lighting);
  }

  private updateColorTargets(score: number, hasDetection: boolean): void {
    let target: ColorRgb;
    if (this.captureAnimationPhase !== 'idle' || this.isCapturing) {
      target = this.hexToRgb('#0080FF');
    } else if (!hasDetection) {
      target = this.hexToRgb('#FF4444');
    } else if (score >= this.config.captureThreshold) {
      target = this.hexToRgb('#00FF00');
    } else if (score >= 70) {
      target = this.hexToRgb('#FFD700');
    } else if (score >= 50) {
      target = this.hexToRgb('#FFA500');
    } else {
      target = this.hexToRgb('#FF4444');
    }

    this.targetColor = target;
  }

  private animateColor(): void {
    const lerp = (start: number, end: number, factor: number) => start + (end - start) * factor;
    this.currentColor = {
      r: lerp(this.currentColor.r, this.targetColor.r, 0.15),
      g: lerp(this.currentColor.g, this.targetColor.g, 0.15),
      b: lerp(this.currentColor.b, this.targetColor.b, 0.15),
    };
    this.scoreColor = this.colorToRgba(this.currentColor, 1);
  }

  private drawOverlay(corners: Point[]): void {
    const canvas = this.canvasElement.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (corners.length !== 4) {
      return;
    }

    const centroid = this.computeCentroid(corners);
    const scale = this.captureAnimationPhase === 'pre'
      ? 1.05
      : this.captureAnimationPhase === 'post'
      ? Math.max(0.05, 1 - Math.min((performance.now() - this.captureAnimationStart) / 400, 1))
      : 1;

    ctx.save();
    ctx.translate(centroid.x, centroid.y);
    ctx.scale(scale, scale);

    ctx.beginPath();
    ctx.moveTo(corners[0].x - centroid.x, corners[0].y - centroid.y);
    for (let i = 1; i < corners.length; i++) {
      ctx.lineTo(corners[i].x - centroid.x, corners[i].y - centroid.y);
    }
    ctx.closePath();

    ctx.lineWidth = 5;
    ctx.strokeStyle = this.colorToRgba(this.currentColor, 0.95);
    ctx.fillStyle = this.colorToRgba(this.currentColor, this.polygonOpacity);
    ctx.stroke();
    ctx.fill();

    for (const corner of corners) {
      ctx.beginPath();
      ctx.arc(corner.x - centroid.x, corner.y - centroid.y, this.cornerRadius * (this.captureAnimationPhase === 'pre' ? 1.2 : 1), 0, Math.PI * 2);
      ctx.fillStyle = this.colorToRgba(this.currentColor, 0.9);
      ctx.fill();
    }

    ctx.restore();
  }

  private handleAutoCapture(score: number): void {
    if (score >= this.config.captureThreshold) {
      if (this.highScoreStartTime === null) {
        this.highScoreStartTime = performance.now();
      }
      const elapsed = performance.now() - this.highScoreStartTime;
      this.updateCountdown(elapsed);
      if (elapsed >= this.config.captureDelay) {
        this.highScoreStartTime = null;
        this.resetCountdown();
        void this.captureDocument();
      }
    } else {
      this.highScoreStartTime = null;
      this.resetCountdown();
    }
  }

  private updateCountdown(elapsed: number): void {
    this.isCountingDown = true;
    const progress = Math.min(elapsed / this.config.captureDelay, 1);
    this.countdownOffset = this.countdownCircumference * (1 - progress);
    const remaining = Math.max(0, this.config.captureDelay - elapsed);
    this.countdownSeconds = Math.ceil(remaining / 1000);
  }

  private resetCountdown(): void {
    this.isCountingDown = false;
    this.countdownOffset = this.countdownCircumference;
    this.countdownSeconds = Math.ceil(this.config.captureDelay / 1000);
  }

  private async captureDocument(): Promise<void> {
    if (this.captureInProgress || this.currentCorners.length !== 4) {
      return;
    }

    this.captureInProgress = true;
    this.isCapturing = true;
    this.captureAnimationPhase = 'pre';
    this.captureAnimationStart = performance.now();
    this.targetColor = this.hexToRgb('#0080FF');
    this.highScoreStartTime = null;
    this.resetCountdown();

    this.queueTimer(() => {
      this.captureAnimationPhase = 'flash';
      this.triggerFlash();
    }, 200);

    this.queueTimer(() => {
      this.captureAnimationPhase = 'post';
    }, 400);

    const result = await this.buildScanResult();

    if (result) {
      this.documentCaptured.emit(result);
      this.captureComplete = true;
      this.queueTimer(() => {
        this.captureComplete = false;
      }, 2000);
    }

    this.queueTimer(() => {
      this.captureAnimationPhase = 'idle';
      this.isCapturing = false;
      this.captureInProgress = false;
    }, 800);
  }

  private triggerFlash(): void {
    this.flashActive = true;
    this.playShutterSound();
    this.queueTimer(() => {
      this.flashActive = false;
    }, 400);
  }

  private async buildScanResult(): Promise<ScanResult | null> {
    const video = this.videoElement.nativeElement;
    if (!video || this.currentCorners.length !== 4) {
      return null;
    }

    await new Promise((resolve) => setTimeout(resolve, 200));

    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    const ctx = captureCanvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
    const frameData = ctx.getImageData(0, 0, captureCanvas.width, captureCanvas.height);

    const srcMat = cv.matFromImageData(frameData);
    const dstSize = this.computeDestinationSize(this.currentCorners);
    const dst = new cv.Mat();

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, this.currentCorners.flatMap((p) => [p.x, p.y]));
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0,
      0,
      dstSize.width,
      0,
      dstSize.width,
      dstSize.height,
      0,
      dstSize.height,
    ]);
    const perspective = cv.getPerspectiveTransform(srcTri, dstTri);

    cv.warpPerspective(srcMat, dst, perspective, new cv.Size(dstSize.width, dstSize.height));

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = dstSize.width;
    outputCanvas.height = dstSize.height;
    cv.imshow(outputCanvas, dst);
    const dataUrl = outputCanvas.toDataURL('image/png');

    srcMat.delete();
    dst.delete();
    srcTri.delete();
    dstTri.delete();
    perspective.delete();

    return {
      dataUrl,
      width: dstSize.width,
      height: dstSize.height,
      capturedAt: Date.now(),
      corners: this.currentCorners.map((corner) => ({ ...corner })),
      quality: {
        overall: this.score,
        stability: this.stabilityScore,
        sharpness: this.sharpnessScore,
        lighting: this.lightingScore,
      },
    };
  }

  private queueTimer(callback: () => void, delay: number): void {
    const timer = window.setTimeout(() => {
      callback();
      this.captureTimers = this.captureTimers.filter((id) => id !== timer);
    }, delay);
    this.captureTimers.push(timer);
  }

  private playShutterSound(): void {
    if (!this.config.enableSound) {
      return;
    }

    if (typeof window === 'undefined' || !(window.AudioContext || (window as any).webkitAudioContext)) {
      return;
    }

    if (!this.audioContext) {
      const AudioContextConstructor = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this.audioContext = new AudioContextConstructor();
    }

    const ctx = this.audioContext;
    if (!ctx) {
      return;
    }

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(900, ctx.currentTime);
    gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.3);
  }

  private computeDestinationSize(corners: Point[]): { width: number; height: number } {
    const widthTop = this.distance(corners[0], corners[1]);
    const widthBottom = this.distance(corners[3], corners[2]);
    const heightLeft = this.distance(corners[0], corners[3]);
    const heightRight = this.distance(corners[1], corners[2]);

    const width = Math.round(Math.max(widthTop, widthBottom));
    const height = Math.round(Math.max(heightLeft, heightRight));

    return {
      width: Math.max(width, 1),
      height: Math.max(height, 1),
    };
  }

  private computeCentroid(corners: Point[]): Point {
    const centroid = corners.reduce(
      (acc, point) => {
        acc.x += point.x;
        acc.y += point.y;
        return acc;
      },
      { x: 0, y: 0 },
    );
    return {
      x: centroid.x / corners.length,
      y: centroid.y / corners.length,
    };
  }

  private distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private colorToRgba(color: ColorRgb, alpha: number): string {
    return `rgba(${color.r.toFixed(0)}, ${color.g.toFixed(0)}, ${color.b.toFixed(0)}, ${alpha})`;
  }

  private hexToRgb(hex: string): ColorRgb {
    const cleaned = hex.replace('#', '');
    const bigint = parseInt(cleaned, 16);
    return {
      r: (bigint >> 16) & 255,
      g: (bigint >> 8) & 255,
      b: bigint & 255,
    };
  }

  private cleanup(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    this.captureTimers.forEach((timer) => window.clearTimeout(timer));
    this.captureTimers = [];

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }
}
