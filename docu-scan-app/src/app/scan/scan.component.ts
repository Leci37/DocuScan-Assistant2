import { AfterViewInit, Component, ElementRef, Inject, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID } from '@angular/core';

type Point = { x: number; y: number };

declare const cv: any;

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

  qualityScore = 0;
  edgeStabilityScore = 0;
  sharpnessScore = 0;
  exposureScore = 0;
  statusMessage = 'Initializing camera…';
  countdownSeconds: number | null = null;
  polygonState: 'low' | 'medium' | 'high' | 'capture' = 'low';
  captureInProgress = false;
  captureAnimationActive = false;
  showCaptureToast = false;
  documentDetected = false;

  private stream: MediaStream | null = null;
  private animationId: number | null = null;
  private processingCanvas: HTMLCanvasElement | null = null;
  private processingCtx: CanvasRenderingContext2D | null = null;
  private overlayCtx: CanvasRenderingContext2D | null = null;
  private isProcessing = false;
  private opencvLoaded = false;
  private highQualityStartTime: number | null = null;
  private lastDetectedCorners: Point[] | null = null;
  private cornerHistory: Point[][] = [];

  private readonly AUTO_CAPTURE_THRESHOLD = 85;
  private readonly AUTO_CAPTURE_DURATION = 3000;
  private readonly STABILITY_WINDOW = 5;

  constructor(@Inject(PLATFORM_ID) private readonly platformId: object) {}

  async ngAfterViewInit(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    try {
      await this.waitForOpenCV();
      await this.startCamera();
    } catch (error) {
      console.error('Initialization error:', error);
      this.statusMessage = 'Unable to initialize scanner';
    }
  }

  ngOnDestroy(): void {
    this.cleanup();
  }

  async captureImage(autoTriggered = false): Promise<void> {
    if (this.captureInProgress || !this.videoElement || !this.documentDetected) {
      return;
    }

    const video = this.videoElement.nativeElement;
    if (!video.videoWidth || !video.videoHeight) {
      return;
    }

    this.captureInProgress = true;
    this.polygonState = 'capture';
    this.captureAnimationActive = true;
    this.statusMessage = autoTriggered ? 'Auto capture in progress…' : 'Capturing…';

    setTimeout(() => {
      this.captureAnimationActive = false;
    }, 500);

    try {
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = video.videoWidth;
      captureCanvas.height = video.videoHeight;
      const captureCtx = captureCanvas.getContext('2d');

      if (!captureCtx) {
        throw new Error('Unable to create capture context');
      }

      captureCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
      const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.95);
      this.triggerDownload(dataUrl);

      this.showCaptureToast = true;
      setTimeout(() => (this.showCaptureToast = false), 2000);
    } catch (error) {
      console.error('Capture failed:', error);
    } finally {
      this.captureInProgress = false;
      this.highQualityStartTime = null;
      this.countdownSeconds = null;
      this.updatePolygonState();
      this.updateStatusMessage(this.documentDetected);
    }
  }

  private async waitForOpenCV(): Promise<void> {
    if (this.opencvLoaded) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        this.opencvLoaded = true;
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(
          new Error(
            'OpenCV.js did not load in time. Check your internet connection and the script configuration.'
          )
        );
      }, 30000);

      const interval = setInterval(() => {
        if (typeof cv !== 'undefined' && cv.Mat) {
          clearTimeout(timeout);
          clearInterval(interval);
          this.opencvLoaded = true;
          resolve();
        }
      }, 100);
    });
  }

  private async startCamera(): Promise<void> {
    if (!this.opencvLoaded) {
      throw new Error('OpenCV.js is not ready');
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
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
      this.initializeProcessing();
      this.statusMessage = 'Align the document within the frame';
    } catch (error) {
      console.error('Unable to access the camera:', error);
      this.statusMessage = 'Camera access denied or unavailable';
      alert('Camera access denied or not available. Please check your permissions.');
    }
  }

  private initializeProcessing(): void {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.style.width = '100%';
    canvas.style.height = '100%';

    this.overlayCtx = canvas.getContext('2d');
    if (!this.overlayCtx) {
      throw new Error('Unable to acquire overlay context');
    }

    this.processingCanvas = document.createElement('canvas');
    this.processingCanvas.width = video.videoWidth;
    this.processingCanvas.height = video.videoHeight;
    this.processingCtx = this.processingCanvas.getContext('2d');

    if (!this.processingCtx) {
      throw new Error('Unable to create processing context');
    }

    const processFrame = () => {
      if (this.isProcessing || !this.overlayCtx || !this.processingCtx) {
        this.animationId = requestAnimationFrame(processFrame);
        return;
      }

      this.isProcessing = true;

      try {
        this.detectDocument();
      } catch (error) {
        console.error('Frame processing error:', error);
      } finally {
        this.isProcessing = false;
        this.animationId = requestAnimationFrame(processFrame);
      }
    };

    processFrame();
  }

  private detectDocument(): void {
    if (!this.overlayCtx || !this.processingCtx || !this.opencvLoaded) {
      return;
    }

    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;

    if (
      video.readyState !== video.HAVE_ENOUGH_DATA ||
      !video.videoWidth ||
      !video.videoHeight
    ) {
      return;
    }

    this.processingCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
    const imageData = this.processingCtx.getImageData(0, 0, video.videoWidth, video.videoHeight);

    let src: any;
    let gray: any;
    let blurred: any;
    let edges: any;
    let contours: any;
    let hierarchy: any;

    try {
      src = cv.matFromImageData(imageData);
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      const mean = new cv.Mat();
      const stddev = new cv.Mat();
      cv.meanStdDev(gray, mean, stddev);
      const meanValue = mean.data64F[0] || 0;
      const sigma = 0.33;
      const lowerThreshold = Math.max(0, (1.0 - sigma) * meanValue);
      const upperThreshold = Math.min(255, (1.0 + sigma) * meanValue);
      mean.delete();
      stddev.delete();

      edges = new cv.Mat();
      cv.Canny(blurred, edges, lowerThreshold, upperThreshold);

      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let bestContour: any = null;
      let maxArea = 0;

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);

        if (area < 10000) {
          contour.delete();
          continue;
        }

        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);

        if (approx.rows === 4 && area > maxArea) {
          if (bestContour) {
            bestContour.delete();
          }
          bestContour = approx;
          maxArea = area;
        } else {
          approx.delete();
        }

        contour.delete();
      }

      if (bestContour) {
        const orderedCorners = this.orderCorners(bestContour);
        this.lastDetectedCorners = orderedCorners;
        this.documentDetected = true;

        const stabilityScore = this.calculateStabilityScore(orderedCorners, canvas.width, canvas.height);
        const sharpnessScore = this.calculateSharpnessScore(gray);
        const exposureScore = this.calculateExposureScore(gray);

        this.updateScores(stabilityScore, sharpnessScore, exposureScore);
        this.updatePolygonState();

        this.handleAutoCapture();
        this.drawPolygon(orderedCorners);
        this.updateStatusMessage(true);

        bestContour.delete();
      } else {
        this.resetDetectionState();
      }
    } catch (error) {
      console.error('Error during detection:', error);
      this.resetDetectionState();
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (blurred) blurred.delete();
      if (edges) edges.delete();
      if (contours) contours.delete();
      if (hierarchy) hierarchy.delete();
    }
  }

  private handleAutoCapture(): void {
    if (!this.documentDetected || this.captureInProgress || !this.lastDetectedCorners) {
      this.highQualityStartTime = null;
      this.countdownSeconds = null;
      return;
    }

    const now = performance.now();

    if (this.qualityScore >= this.AUTO_CAPTURE_THRESHOLD) {
      if (this.highQualityStartTime === null) {
        this.highQualityStartTime = now;
      }

      const elapsed = now - this.highQualityStartTime;
      const remaining = Math.max(this.AUTO_CAPTURE_DURATION - elapsed, 0);
      this.countdownSeconds = Math.round((remaining / 1000) * 10) / 10;

      if (elapsed >= this.AUTO_CAPTURE_DURATION) {
        this.highQualityStartTime = null;
        this.countdownSeconds = null;
        void this.captureImage(true);
      }
    } else {
      this.highQualityStartTime = null;
      this.countdownSeconds = null;
    }
  }

  private drawPolygon(corners: Point[]): void {
    if (!this.overlayCtx) {
      return;
    }

    const canvas = this.canvasElement.nativeElement;
    this.overlayCtx.clearRect(0, 0, canvas.width, canvas.height);

    const { strokeStyle, fillStyle, cornerFill } = this.getPolygonStyles();

    this.overlayCtx.beginPath();
    this.overlayCtx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) {
      this.overlayCtx.lineTo(corners[i].x, corners[i].y);
    }
    this.overlayCtx.closePath();

    this.overlayCtx.fillStyle = fillStyle;
    this.overlayCtx.strokeStyle = strokeStyle;
    this.overlayCtx.lineWidth = 4;
    this.overlayCtx.lineJoin = 'round';

    this.overlayCtx.fill();
    this.overlayCtx.stroke();

    this.overlayCtx.fillStyle = cornerFill;
    for (const corner of corners) {
      this.overlayCtx.beginPath();
      this.overlayCtx.arc(corner.x, corner.y, 8, 0, Math.PI * 2);
      this.overlayCtx.fill();
    }
  }

  private getPolygonStyles(): { strokeStyle: string; fillStyle: string; cornerFill: string } {
    if (this.polygonState === 'capture') {
      return {
        strokeStyle: 'rgba(0, 122, 255, 0.9)',
        fillStyle: 'rgba(0, 122, 255, 0.25)',
        cornerFill: 'rgba(0, 122, 255, 0.95)'
      };
    }

    if (this.polygonState === 'high') {
      return {
        strokeStyle: 'rgba(0, 200, 83, 0.95)',
        fillStyle: 'rgba(0, 200, 83, 0.25)',
        cornerFill: 'rgba(0, 200, 83, 0.95)'
      };
    }

    if (this.polygonState === 'medium') {
      return {
        strokeStyle: 'rgba(255, 193, 7, 0.95)',
        fillStyle: 'rgba(255, 193, 7, 0.2)',
        cornerFill: 'rgba(255, 193, 7, 0.95)'
      };
    }

    return {
      strokeStyle: 'rgba(244, 67, 54, 0.95)',
      fillStyle: 'rgba(244, 67, 54, 0.15)',
      cornerFill: 'rgba(244, 67, 54, 0.95)'
    };
  }

  private resetDetectionState(): void {
    this.documentDetected = false;
    this.lastDetectedCorners = null;
    this.cornerHistory = [];
    this.highQualityStartTime = null;
    this.countdownSeconds = null;
    this.qualityScore = 0;
    this.edgeStabilityScore = 0;
    this.sharpnessScore = 0;
    this.exposureScore = 0;
    this.updatePolygonState();
    this.updateStatusMessage(false);

    if (this.overlayCtx) {
      const canvas = this.canvasElement.nativeElement;
      this.overlayCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  private calculateStabilityScore(corners: Point[], width: number, height: number): number {
    const clonedCorners = corners.map((corner) => ({ ...corner }));
    this.cornerHistory.push(clonedCorners);

    if (this.cornerHistory.length > this.STABILITY_WINDOW) {
      this.cornerHistory.shift();
    }

    if (this.cornerHistory.length < 2) {
      return 100;
    }

    const previous = this.cornerHistory[this.cornerHistory.length - 2];
    let totalDistance = 0;

    for (let i = 0; i < corners.length; i++) {
      const dx = corners[i].x - previous[i].x;
      const dy = corners[i].y - previous[i].y;
      totalDistance += Math.hypot(dx, dy);
    }

    const avgDistance = totalDistance / corners.length;
    const diag = Math.hypot(width, height);
    const maxJitter = diag * 0.02; // Allow 2% of diagonal movement for perfect score
    const normalized = Math.min(avgDistance / maxJitter, 1);
    const score = Math.max(0, Math.round((1 - normalized) * 100));

    return score;
  }

  private calculateSharpnessScore(gray: any): number {
    const laplace = new cv.Mat();
    cv.Laplacian(gray, laplace, cv.CV_64F, 3, 1, 0, cv.BORDER_DEFAULT);

    const mean = new cv.Mat();
    const stddev = new cv.Mat();
    cv.meanStdDev(laplace, mean, stddev);

    const variance = Math.pow(stddev.data64F[0] || 0, 2);
    const normalized = Math.min(variance / 1500, 1);
    const score = Math.max(0, Math.round(normalized * 100));

    laplace.delete();
    mean.delete();
    stddev.delete();

    return score;
  }

  private calculateExposureScore(gray: any): number {
    const mean = new cv.Mat();
    const stddev = new cv.Mat();
    cv.meanStdDev(gray, mean, stddev);

    const brightness = mean.data64F[0] || 0;
    const contrast = stddev.data64F[0] || 0;

    const brightnessDeviation = Math.min(Math.abs(brightness - 130), 130);
    const brightnessScore = 1 - brightnessDeviation / 130;

    const contrastScore = Math.min(contrast / 64, 1);

    const combined = 0.6 * brightnessScore + 0.4 * contrastScore;
    const score = Math.max(0, Math.min(100, Math.round(combined * 100)));

    mean.delete();
    stddev.delete();

    return score;
  }

  private updateScores(stability: number, sharpness: number, exposure: number): void {
    this.edgeStabilityScore = Math.round(stability);
    this.sharpnessScore = Math.round(sharpness);
    this.exposureScore = Math.round(exposure);

    const combined = 0.35 * stability + 0.35 * sharpness + 0.3 * exposure;
    this.qualityScore = Math.round(combined);
  }

  private updatePolygonState(): void {
    if (this.captureInProgress) {
      this.polygonState = 'capture';
      return;
    }

    if (this.qualityScore >= this.AUTO_CAPTURE_THRESHOLD) {
      this.polygonState = 'high';
    } else if (this.qualityScore >= 60) {
      this.polygonState = 'medium';
    } else {
      this.polygonState = 'low';
    }
  }

  private updateStatusMessage(hasContour: boolean): void {
    if (!hasContour) {
      this.statusMessage = 'Align the document within the frame';
      return;
    }

    if (this.captureInProgress) {
      this.statusMessage = 'Capturing…';
      return;
    }

    if (this.qualityScore >= this.AUTO_CAPTURE_THRESHOLD) {
      this.statusMessage = this.countdownSeconds !== null
        ? 'Hold steady for auto capture'
        : 'Ready to capture';
      return;
    }

    if (this.qualityScore >= 60) {
      this.statusMessage = 'Almost there – steady the camera and reduce glare';
      return;
    }

    this.statusMessage = 'Improve focus, lighting, or alignment';
  }

  private orderCorners(contour: any): Point[] {
    const coords: Point[] = [];
    for (let i = 0; i < contour.rows; i++) {
      const point = contour.intPtr(i, 0);
      coords.push({ x: point[0], y: point[1] });
    }

    const center = coords.reduce(
      (acc, point) => ({ x: acc.x + point.x / coords.length, y: acc.y + point.y / coords.length }),
      { x: 0, y: 0 }
    );

    const withAngles = coords
      .map((point) => ({
        ...point,
        angle: Math.atan2(point.y - center.y, point.x - center.x)
      }))
      .sort((a, b) => a.angle - b.angle);

    let startIndex = 0;
    let smallestSum = Number.POSITIVE_INFINITY;
    withAngles.forEach((point, index) => {
      const sum = point.x + point.y;
      if (sum < smallestSum) {
        smallestSum = sum;
        startIndex = index;
      }
    });

    const ordered: Point[] = [];
    for (let i = 0; i < withAngles.length; i++) {
      const idx = (startIndex + i) % withAngles.length;
      const { x, y } = withAngles[idx];
      ordered.push({ x, y });
    }

    return ordered;
  }

  private triggerDownload(dataUrl: string): void {
    const link = document.createElement('a');
    link.download = `scan-${Date.now()}.jpg`;
    link.href = dataUrl;
    link.click();
  }

  private cleanup(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    this.processingCanvas = null;
    this.processingCtx = null;
    this.overlayCtx = null;
  }
}
