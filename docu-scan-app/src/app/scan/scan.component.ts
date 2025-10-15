import { AfterViewInit, Component, ElementRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { NgIf } from '@angular/common';

declare const cv: any;

type Corner = { x: number; y: number };

@Component({
  selector: 'app-scan',
  standalone: true,
  imports: [NgIf],
  templateUrl: './scan.component.html',
  styleUrls: ['./scan.component.css']
})
export class ScanComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('video', { static: false }) private readonly videoRef!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasOverlay', { static: false }) private readonly canvasRef!: ElementRef<HTMLCanvasElement>;

  documentDetected = false;

  private streaming = false;
  private stream: MediaStream | null = null;
  private currentCorners: Corner[] | null = null;
  private animationFrameId: number | null = null;
  private openCvReadyPromise: Promise<void> | null = null;
  private videoProcessingResources:
    | {
        cap: any;
        src: any;
        gray: any;
        blurred: any;
        edges: any;
        contours: any;
        hierarchy: any;
        kernel: any;
      }
    | null = null;

  async ngOnInit(): Promise<void> {
    this.openCvReadyPromise = this.waitForOpenCv(30000);

    try {
      await this.openCvReadyPromise;
      console.log('OpenCV.js loaded successfully');
    } catch (error) {
      console.error('OpenCV.js failed to load:', error);
    }
  }

  async ngAfterViewInit(): Promise<void> {
    try {
      await (this.openCvReadyPromise ?? this.waitForOpenCv(30000));
      await this.startCamera();
    } catch (error) {
      console.error('Unable to start camera:', error);
    }
  }

  ngOnDestroy(): void {
    this.streaming = false;
    this.disposeVideoProcessingResources();

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }
  }

  captureImage(): void {
    if (!this.documentDetected || !this.currentCorners?.length) {
      alert('No document detected. Please position the document clearly.');
      return;
    }

    const video = this.videoRef.nativeElement;
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    const ctx = captureCanvas.getContext('2d');

    if (!ctx) {
      console.error('Unable to capture document: no 2D context available.');
      return;
    }

    ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

    const dataUrl = captureCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `document-scan-${Date.now()}.png`;
    link.click();

    console.log('Document captured with corners:', this.currentCorners);
  }

  private async startCamera(): Promise<void> {
    const video = this.videoRef.nativeElement;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      });

      video.srcObject = this.stream;

      video.onloadedmetadata = async () => {
        try {
          await video.play();
          this.streaming = true;

          const canvas = this.canvasRef.nativeElement;
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.style.width = `${video.videoWidth}px`;
          canvas.style.height = `${video.videoHeight}px`;

          this.initializeProcessing();
        } catch (error) {
          console.error('Video playback failed:', error);
        }
      };
    } catch (error) {
      console.error('Camera access error:', error);
      alert('Unable to access camera. Please grant camera permissions.');
    }
  }

  private initializeProcessing(): void {
    const video = this.videoRef.nativeElement;
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      console.error('Canvas 2D context could not be initialized.');
      return;
    }

    this.disposeVideoProcessingResources();

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.style.width = `${video.videoWidth}px`;
    canvas.style.height = `${video.videoHeight}px`;

    const cap = new cv.VideoCapture(video);
    const src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const edges = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));

    this.videoProcessingResources = { cap, src, gray, blurred, edges, contours, hierarchy, kernel };

    const processFrame = () => {
      if (!this.streaming) {
        this.disposeVideoProcessingResources();
        return;
      }

      try {
        this.detectDocument(ctx, canvas);
      } catch (error) {
        console.error('Processing error:', error);
      }

      this.animationFrameId = requestAnimationFrame(processFrame);
    };

    this.animationFrameId = requestAnimationFrame(processFrame);
  }

  private detectDocument(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const resources = this.videoProcessingResources;
    const video = this.videoRef.nativeElement;

    if (!resources) {
      return;
    }

    if (resources.src.rows !== video.videoHeight || resources.src.cols !== video.videoWidth) {
      console.warn('Video dimensions changed. Re-initializing processing resources.');
      this.initializeProcessing();
      return;
    }

    const { cap, src, gray, blurred, edges, contours, hierarchy, kernel } = resources;

    cap.read(src);
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);
    cv.dilate(edges, edges, kernel);
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let largestContourIndex = -1;
    let maxArea = 0;
    const minArea = canvas.width * canvas.height * 0.1;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);

      if (area > maxArea && area > minArea) {
        maxArea = area;
        largestContourIndex = i;
      }
    }

    this.documentDetected = false;
    this.currentCorners = null;

    if (largestContourIndex >= 0) {
      const largestContour = contours.get(largestContourIndex);
      const peri = cv.arcLength(largestContour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(largestContour, approx, 0.02 * peri, true);

      if (approx.rows === 4) {
        this.documentDetected = true;
        this.currentCorners = [];

        ctx.strokeStyle = 'rgba(0, 123, 255, 0.9)';
        ctx.fillStyle = 'rgba(0, 123, 255, 0.2)';
        ctx.lineWidth = 4;
        ctx.beginPath();

        for (let j = 0; j < approx.rows; j++) {
          const x = approx.data32S[j * 2];
          const y = approx.data32S[j * 2 + 1];
          this.currentCorners.push({ x, y });

          if (j === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }

        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(0, 123, 255, 0.9)';
        for (const corner of this.currentCorners) {
          ctx.beginPath();
          ctx.arc(corner.x, corner.y, 8, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      approx.delete();
      largestContour.delete();
    }

    for (let i = 0; i < contours.size(); i++) {
      contours.get(i).delete();
    }
  }

  private disposeVideoProcessingResources(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (!this.videoProcessingResources) {
      return;
    }

    const { cap, src, gray, blurred, edges, contours, hierarchy, kernel } = this.videoProcessingResources;

    src.delete();
    gray.delete();
    blurred.delete();
    edges.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();

    if (cap && typeof cap.delete === 'function') {
      cap.delete();
    }

    this.videoProcessingResources = null;
  }

  /**
   * Waits for the global cv object to be available.
   * @param maxAttempts - The maximum number of times to check.
   * @param delay - The delay in ms between checks.
   * @returns A Promise that resolves when OpenCV is ready, or rejects on timeout.
   */
  private waitForOpenCv(timeout = 30000): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof cv !== 'undefined' && typeof cv.Mat !== 'undefined') {
        resolve();
        return;
      }

      const checkInterval = 100;
      const timeoutId = setTimeout(() => {
        clearInterval(intervalId);
        reject(new Error('OpenCV.js did not load in time. Check your internet connection and OpenCV.js URL.'));
      }, timeout);

      const intervalId = setInterval(() => {
        if (typeof cv !== 'undefined' && typeof cv.Mat !== 'undefined') {
          clearTimeout(timeoutId);
          clearInterval(intervalId);
          resolve();
        }
      }, checkInterval);
    });
  }
}
