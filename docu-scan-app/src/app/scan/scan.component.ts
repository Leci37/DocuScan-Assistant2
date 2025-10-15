import { Component, ElementRef, ViewChild, OnDestroy, AfterViewInit, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';
import { CameraService } from './camera.service';
import { DetectionResult, OpenCVService } from './opencv.service';
import {
  CAPTURE_FLASH_COLOR,
  CAPTURE_FLASH_DURATION_MS,
  CORNER_MARKER_RADIUS,
  CORNER_MOVEMENT_THRESHOLD,
  DETECTION_STROKE_WIDTH,
  DOCUMENT_CORNER_COUNT,
  STABLE_THRESHOLD,
  STEADY_FILL_STYLE,
  STEADY_STROKE_STYLE,
  UNSTEADY_FILL_STYLE,
  UNSTEADY_STROKE_STYLE
} from './scanner-config';

@Component({
  selector: 'app-scan',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scan.component.html',
  styleUrls: ['./scan.component.css']
})
export class ScanComponent implements AfterViewInit, OnDestroy {
  @ViewChild('video') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas') canvasElement!: ElementRef<HTMLCanvasElement>;

  private stream: MediaStream | null = null;
  private animationId: number | null = null;
  private isProcessing = false;

  documentDetected = false;
  isSteady = false;

  private detectionStableCount = 0;
  private lastKnownCorners: number[] | null = null;

  constructor(
    @Inject(PLATFORM_ID) private readonly platformId: Object,
    private readonly cameraService: CameraService,
    private readonly openCVService: OpenCVService
  ) {}

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      await this.openCVService.loadOpenCV();
      await this.startCamera();
    } catch (error) {
      console.error('Initialization error:', error);
    }
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  private async startCamera(): Promise<void> {
    try {
      const video = this.videoElement.nativeElement;
      this.stream = await this.cameraService.startCamera(video);
      console.log(`Video dimensions: ${video.videoWidth}x${video.videoHeight}`);
      this.initializeProcessing();
    } catch (error) {
      console.error('Unable to start camera:', error);
      alert('Camera access denied or not available. Please check your permissions.');
    }
  }

  private initializeProcessing(): void {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const processFrame = () => {
      if (this.isProcessing) {
        this.animationId = requestAnimationFrame(processFrame);
        return;
      }

      try {
        this.isProcessing = true;
        const result = this.openCVService.processFrame(video);
        this.updateDetectionState(result);
        this.drawOverlay(result.corners);
      } catch (error) {
        console.error('Processing error:', error);
      } finally {
        this.isProcessing = false;
        this.animationId = requestAnimationFrame(processFrame);
      }
    };

    processFrame();
  }

  private updateDetectionState(result: DetectionResult): void {
    const corners = result.corners;

    if (corners && corners.length >= DOCUMENT_CORNER_COUNT * 2) {
      const currentCorners = [...corners];
      this.documentDetected = true;

      if (this.lastKnownCorners) {
        let totalDistance = 0;
        for (let i = 0; i < DOCUMENT_CORNER_COUNT; i++) {
          const dx = currentCorners[i * 2] - this.lastKnownCorners[i * 2];
          const dy = currentCorners[i * 2 + 1] - this.lastKnownCorners[i * 2 + 1];
          totalDistance += Math.sqrt(dx * dx + dy * dy);
        }

        if (totalDistance < CORNER_MOVEMENT_THRESHOLD * DOCUMENT_CORNER_COUNT) {
          this.detectionStableCount++;
        } else {
          this.detectionStableCount = 0;
        }
      } else {
        this.detectionStableCount = 0;
      }

      this.lastKnownCorners = currentCorners;
      this.isSteady = this.detectionStableCount >= STABLE_THRESHOLD;
    } else {
      this.resetDetectionState();
    }
  }

  private drawOverlay(corners: number[] | null): void {
    const canvas = this.canvasElement.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const video = this.videoElement.nativeElement;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    if (!corners || corners.length < DOCUMENT_CORNER_COUNT * 2) {
      return;
    }

    const strokeStyle = this.isSteady ? STEADY_STROKE_STYLE : UNSTEADY_STROKE_STYLE;
    const fillStyle = this.isSteady ? STEADY_FILL_STYLE : UNSTEADY_FILL_STYLE;

    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = DETECTION_STROKE_WIDTH;
    ctx.fillStyle = fillStyle;

    ctx.beginPath();
    ctx.moveTo(corners[0], corners[1]);
    for (let i = 1; i < DOCUMENT_CORNER_COUNT; i++) {
      ctx.lineTo(corners[i * 2], corners[i * 2 + 1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = strokeStyle;
    for (let i = 0; i < DOCUMENT_CORNER_COUNT; i++) {
      ctx.beginPath();
      ctx.arc(corners[i * 2], corners[i * 2 + 1], CORNER_MARKER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private resetDetectionState(): void {
    this.documentDetected = false;
    this.isSteady = false;
    this.detectionStableCount = 0;
    this.lastKnownCorners = null;
  }

  captureImage(): void {
    if (!this.isSteady) {
      console.warn('Document not steady yet');
      return;
    }

    const canvas = this.canvasElement.nativeElement;
    const dataUrl = canvas.toDataURL('image/png');

    const link = document.createElement('a');
    link.download = `scan-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();

    this.showCaptureFlash();
  }

  private showCaptureFlash(): void {
    const canvas = this.canvasElement.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.fillStyle = CAPTURE_FLASH_COLOR;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    setTimeout(() => {
      // Flash will be cleared on next frame draw
    }, CAPTURE_FLASH_DURATION_MS);
  }

  private cleanup(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.stream) {
      this.cameraService.stopStream(this.stream);
      const video = this.videoElement.nativeElement;
      video.srcObject = null;
      this.stream = null;
    }

    this.resetDetectionState();
  }
}
