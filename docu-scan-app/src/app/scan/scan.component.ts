import { Component, ElementRef, ViewChild, OnDestroy, AfterViewInit, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';

declare var cv: any;

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
  private opencvLoaded = false;

  documentDetected = false;
  detectionScore = 0;
  sharpnessScore = 0;
  autoCaptureCountdown = 0;
  isCountdownActive = false;
  isCapturing = false;

  private detectionStableCount = 0;
  private lastKnownCorners: number[] | null = null;

  private readonly STABLE_THRESHOLD = 5;
  private readonly CORNER_MOVEMENT_THRESHOLD = 5;
  private readonly AUTO_CAPTURE_DURATION = 2500;
  private readonly MAX_SHARPNESS_VARIANCE = 2500;

  private autoCaptureTimeoutId: number | null = null;
  private autoCaptureIntervalId: number | null = null;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  async ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      await this.waitForOpenCV();
      await this.startCamera();
    }
  }

  ngOnDestroy() {
    this.cancelAutoCaptureCountdown();
    this.cleanup();
  }

  private async waitForOpenCV(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        console.log('OpenCV.js already loaded');
        this.opencvLoaded = true;
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        reject(new Error('OpenCV.js did not load in time.'));
      }, 30000);

      const checkInterval = setInterval(() => {
        if (typeof cv !== 'undefined' && cv.Mat) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          console.log('OpenCV.js loaded successfully');
          this.opencvLoaded = true;
          resolve();
        }
      }, 100);
    });
  }

  private async startCamera() {
    try {
      if (!this.opencvLoaded) {
        throw new Error('OpenCV.js is not loaded');
      }

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
          video.play();
          console.log(`Video dimensions: ${video.videoWidth}x${video.videoHeight}`);
          resolve();
        };
      });

      await new Promise(resolve => setTimeout(resolve, 500));

      this.initializeProcessing();
    } catch (error) {
      console.error('Unable to start camera:', error);
      alert('Camera access denied or not available. Please check your permissions.');
    }
  }

  private initializeProcessing() {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    console.log(`Canvas set to: ${canvas.width}x${canvas.height}`);

    const processFrame = () => {
      if (this.isProcessing) {
        this.animationId = requestAnimationFrame(processFrame);
        return;
      }

      try {
        this.isProcessing = true;
        this.detectDocument();
      } catch (error) {
        console.error('Processing error:', error);
      } finally {
        this.isProcessing = false;
        this.animationId = requestAnimationFrame(processFrame);
      }
    };

    processFrame();
  }

  private detectDocument() {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;
    const ctx = canvas.getContext('2d');

    if (!ctx || !this.opencvLoaded) return;

    if (video.readyState !== video.HAVE_ENOUGH_DATA ||
        video.videoWidth === 0 ||
        video.videoHeight === 0) {
      return;
    }

    let src: any = null, gray: any = null, blurred: any = null, edges: any = null,
        hierarchy: any = null, contours: any = null;

    try {
      src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = video.videoWidth;
      tempCanvas.height = video.videoHeight;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) return;
      tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
      const imageData = tempCtx.getImageData(0, 0, video.videoWidth, video.videoHeight);
      src.data.set(imageData.data);

      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      const medianMat = new cv.Mat();
      cv.medianBlur(gray, medianMat, 15);
      const medianValue = medianMat.data[Math.floor(medianMat.rows * medianMat.cols / 2)];
      medianMat.delete();

      const sigma = 0.33;
      const lowerThreshold = Math.max(0, (1.0 - sigma) * medianValue);
      const upperThreshold = Math.min(255, (1.0 + sigma) * medianValue);

      edges = new cv.Mat();
      cv.Canny(blurred, edges, lowerThreshold, upperThreshold);

      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      let maxArea = 0;
      let bestContour: any = null;

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);

        if (approx.rows === 4 && area > maxArea && area > 10000) {
          maxArea = area;
          if (bestContour) bestContour.delete();
          bestContour = approx;
        } else {
          approx.delete();
        }
      }

      if (bestContour) {
        this.documentDetected = true;
        const currentCorners = Array.from(bestContour.data32S as Int32Array);

        if (this.lastKnownCorners) {
          let totalDistance = 0;
          for (let i = 0; i < 4; i++) {
            const dx = currentCorners[i * 2] - this.lastKnownCorners[i * 2];
            const dy = currentCorners[i * 2 + 1] - this.lastKnownCorners[i * 2 + 1];
            totalDistance += Math.sqrt(dx * dx + dy * dy);
          }

          if (totalDistance < this.CORNER_MOVEMENT_THRESHOLD * 4) {
            this.detectionStableCount = Math.min(this.detectionStableCount + 1, this.STABLE_THRESHOLD * 3);
          } else {
            this.detectionStableCount = Math.max(this.detectionStableCount - 1, 0);
          }
        } else {
          this.detectionStableCount = 0;
        }

        this.lastKnownCorners = currentCorners;

        const stabilityNormalized = Math.min(this.detectionStableCount / this.STABLE_THRESHOLD, 1);
        const sharpness = this.calculateSharpness(gray);
        this.sharpnessScore = Math.round(sharpness);
        this.detectionScore = Math.round((stabilityNormalized * 0.7 + (this.sharpnessScore / 100) * 0.3) * 100);

        if (this.detectionScore >= 95) {
          this.startAutoCaptureCountdown();
        } else {
          this.cancelAutoCaptureCountdown();
        }

        const strokeColor = this.isCountdownActive
          ? 'rgba(66, 133, 244, 0.9)'
          : (this.detectionScore >= 70 ? 'rgba(76, 175, 80, 0.9)' : 'rgba(255, 215, 0, 0.9)');
        const fillColor = this.isCountdownActive
          ? 'rgba(66, 133, 244, 0.25)'
          : (this.detectionScore >= 70 ? 'rgba(76, 175, 80, 0.2)' : 'rgba(255, 215, 0, 0.2)');

        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 4;
        ctx.fillStyle = fillColor;

        ctx.beginPath();
        ctx.moveTo(currentCorners[0], currentCorners[1]);
        for (let i = 1; i < 4; i++) {
          ctx.lineTo(currentCorners[i * 2], currentCorners[i * 2 + 1]);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = strokeColor;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(currentCorners[i * 2], currentCorners[i * 2 + 1], 8, 0, 2 * Math.PI);
          ctx.fill();
        }

        bestContour.delete();
      } else {
        this.resetDetectionState();
      }
    } catch (error) {
      console.error('Error in detectDocument:', error);
      this.resetDetectionState();
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (blurred) blurred.delete();
      if (edges) edges.delete();
      if (hierarchy) hierarchy.delete();
      if (contours) contours.delete();
    }
  }

  private resetDetectionState() {
    this.documentDetected = false;
    this.detectionStableCount = 0;
    this.lastKnownCorners = null;
    this.detectionScore = 0;
    this.sharpnessScore = 0;
    this.cancelAutoCaptureCountdown();
  }

  private calculateSharpness(imageMat: any): number {
    const laplacian = new cv.Mat();
    cv.Laplacian(imageMat, laplacian, cv.CV_64F);
    const mean = new cv.Mat();
    const stdDev = new cv.Mat();
    cv.meanStdDev(laplacian, mean, stdDev);
    const variance = Math.pow(stdDev.doubleAt(0, 0), 2);
    laplacian.delete();
    mean.delete();
    stdDev.delete();

    const normalized = Math.min(variance / this.MAX_SHARPNESS_VARIANCE, 1);
    return Math.max(0, Math.min(100, normalized * 100));
  }

  private startAutoCaptureCountdown() {
    if (this.autoCaptureTimeoutId !== null || this.isCapturing) {
      return;
    }

    this.isCountdownActive = true;
    this.autoCaptureCountdown = this.AUTO_CAPTURE_DURATION / 1000;
    const start = Date.now();

    this.autoCaptureTimeoutId = window.setTimeout(() => {
      this.completeAutoCapture();
    }, this.AUTO_CAPTURE_DURATION);

    this.autoCaptureIntervalId = window.setInterval(() => {
      const remaining = Math.max(this.AUTO_CAPTURE_DURATION - (Date.now() - start), 0);
      this.autoCaptureCountdown = Math.max(0, Math.round(remaining / 100) / 10);
      if (remaining <= 0) {
        this.clearAutoCaptureInterval();
      }
    }, 100);
  }

  private completeAutoCapture() {
    this.autoCaptureTimeoutId = null;
    this.clearAutoCaptureInterval();
    this.isCountdownActive = false;
    this.autoCaptureCountdown = 0;
    if (this.documentDetected) {
      this.captureImage();
    }
  }

  private cancelAutoCaptureCountdown() {
    if (this.autoCaptureTimeoutId !== null) {
      window.clearTimeout(this.autoCaptureTimeoutId);
      this.autoCaptureTimeoutId = null;
    }
    this.clearAutoCaptureInterval();
    if (this.isCountdownActive) {
      this.isCountdownActive = false;
      this.autoCaptureCountdown = 0;
    }
  }

  private clearAutoCaptureInterval() {
    if (this.autoCaptureIntervalId !== null) {
      window.clearInterval(this.autoCaptureIntervalId);
      this.autoCaptureIntervalId = null;
    }
  }

  manualCapture() {
    this.cancelAutoCaptureCountdown();
    this.captureImage();
  }

  captureImage() {
    if (!this.documentDetected) {
      console.warn('No document detected');
      return;
    }

    if (this.isCapturing) {
      return;
    }

    this.cancelAutoCaptureCountdown();
    this.isCapturing = true;

    const canvas = this.canvasElement.nativeElement;
    const dataUrl = canvas.toDataURL('image/png');

    const link = document.createElement('a');
    link.download = `scan-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();

    setTimeout(() => {
      this.isCapturing = false;
    }, 400);
  }

  private cleanup() {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }
}
