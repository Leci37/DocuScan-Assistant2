import {
  Component,
  ElementRef,
  ViewChild,
  OnDestroy,
  AfterViewInit,
  PLATFORM_ID,
  Inject,
  Input
} from '@angular/core';
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

  // Configuration
  @Input() autoCaptureEnabled = false;

  // Public properties for template
  documentDetected = false;
  autoCaptureFeedback = '';
  imageQuality = 0;
  private detectionStableCount = 0;
  private readonly STABLE_THRESHOLD = 10; // Frames needed for stability
  private readonly SHARPNESS_THRESHOLD = 50; // Adjust as needed
  private readonly LIGHTING_THRESHOLD_LOW = 50;
  private readonly LIGHTING_THRESHOLD_HIGH = 200;
  private lastSharp = false;
  private lastWellLit = false;
  private autoCaptureTriggered = false;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  async ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      await this.waitForOpenCV();
      await this.startCamera();
    }
  }

  ngOnDestroy() {
    this.cleanup();
  }

  private async waitForOpenCV(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if OpenCV is already loaded
      if (typeof cv !== 'undefined' && cv.Mat) {
        console.log('OpenCV.js already loaded');
        this.opencvLoaded = true;
        resolve();
        return;
      }

      // Set up timeout (30 seconds)
      const timeout = setTimeout(() => {
        reject(new Error('OpenCV.js did not load in time. Check your internet connection and OpenCV.js URL.'));
      }, 30000);

      // Wait for OpenCV to load
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

      // Request camera with specific constraints
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      const video = this.videoElement.nativeElement;
      video.srcObject = this.stream;

      // Wait for video metadata to load
      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          console.log(`Video dimensions: ${video.videoWidth}x${video.videoHeight}`);
          resolve();
        };
      });

      // Additional small delay to ensure video is fully ready
      await new Promise(resolve => setTimeout(resolve, 500));

      // Initialize processing after video is ready
      this.initializeProcessing();
    } catch (error) {
      console.error('Unable to start camera:', error);
      alert('Camera access denied or not available. Please check your permissions.');
    }
  }

  private initializeProcessing() {
    const video = this.videoElement.nativeElement;
    const canvas = this.canvasElement.nativeElement;

    // Set canvas dimensions to match video
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    console.log(`Canvas set to: ${canvas.width}x${canvas.height}`);

    // Start processing frames
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

    if (
      video.readyState !== video.HAVE_ENOUGH_DATA ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return;
    }

    let src: any = null;
    let gray: any = null;
    let blurred: any = null;
    let edges: any = null;
    let hierarchy: any = null;
    let contours: any = null;

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
      
      // --- NEW: Dynamic Threshold Calculation ---
      // This makes the edge detection adaptive to lighting conditions.
      const medianMat = new cv.Mat();
      // Using a larger kernel size for median blur helps find a more representative median value for the whole image.
      cv.medianBlur(gray, medianMat, 15); 
      const medianValue = medianMat.data[Math.floor(medianMat.rows * medianMat.cols / 2)];
      medianMat.delete();
      
      const sigma = 0.33;
      const lowerThreshold = Math.max(0, (1.0 - sigma) * medianValue);
      const upperThreshold = Math.min(255, (1.0 + sigma) * medianValue);
      
      edges = new cv.Mat();
      cv.Canny(blurred, edges, lowerThreshold, upperThreshold);
      // --- END NEW ---

      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      this.calculateImageQuality(gray);

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
        this.detectionStableCount++;

        if (this.detectionStableCount >= this.STABLE_THRESHOLD) {
          this.documentDetected = true;
          if (this.autoCaptureEnabled) {
            this.attemptAutoCapture();
          } else {
            this.autoCaptureFeedback = '';
          }
        }

        ctx.strokeStyle = 'rgba(0, 255, 0, 0.8)';
        ctx.lineWidth = 4;
        ctx.fillStyle = 'rgba(255, 255, 0, 0.2)';

        ctx.beginPath();
        const firstPoint = bestContour.data32S;
        ctx.moveTo(firstPoint[0], firstPoint[1]);

        for (let i = 1; i < 4; i++) {
          ctx.lineTo(firstPoint[i * 2], firstPoint[i * 2 + 1]);
        }

        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(firstPoint[i * 2], firstPoint[i * 2 + 1], 8, 0, 2 * Math.PI);
          ctx.fill();
        }

        bestContour.delete();
      } else {
        this.detectionStableCount = 0;
        this.documentDetected = false;
        this.autoCaptureFeedback = '';
        this.autoCaptureTriggered = false;
      }

    } catch (error) {
      console.error('Error in detectDocument:', error);
      this.documentDetected = false;
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (blurred) blurred.delete();
      if (edges) edges.delete();
      if (hierarchy) hierarchy.delete();
      if (contours) contours.delete();
    }
  }

  private calculateImageQuality(gray: any) {
    this.lastSharp = this.isSharp(gray);
    this.lastWellLit = this.isWellLit(gray);
    this.imageQuality = (this.lastSharp ? 50 : 0) + (this.lastWellLit ? 50 : 0);
  }

  private isSharp(gray: any): boolean {
    let laplacian: any = null;
    let mean: any = null;
    let stdDev: any = null;
    try {
      laplacian = new cv.Mat();
      cv.Laplacian(gray, laplacian, cv.CV_64F);

      mean = new cv.Mat();
      stdDev = new cv.Mat();
      cv.meanStdDev(laplacian, mean, stdDev);

      const variance = stdDev.data64F[0] * stdDev.data64F[0];
      return variance > this.SHARPNESS_THRESHOLD;
    } finally {
      if (laplacian) laplacian.delete();
      if (mean) mean.delete();
      if (stdDev) stdDev.delete();
    }
  }

  private isWellLit(gray: any): boolean {
    let hist: any = null;
    let mask: any = null;
    let srcVec: any = null;
    try {
      srcVec = new cv.MatVector();
      srcVec.push_back(gray);
      hist = new cv.Mat();
      mask = new cv.Mat();

      cv.calcHist(srcVec, [0], mask, hist, [256], [0, 255]);
      const mean = cv.mean(gray, mask)[0];

      return mean > this.LIGHTING_THRESHOLD_LOW && mean < this.LIGHTING_THRESHOLD_HIGH;
    } finally {
      if (hist) hist.delete();
      if (mask) mask.delete();
      if (srcVec) srcVec.delete();
    }
  }

  private attemptAutoCapture() {
    if (this.autoCaptureTriggered) {
      this.autoCaptureFeedback = '✓ Auto-captured';
      return;
    }

    this.autoCaptureFeedback = 'Hold steady...';

    if (!this.lastSharp) {
      this.autoCaptureFeedback = 'Image is blurry';
      return;
    }

    if (!this.lastWellLit) {
      this.autoCaptureFeedback = 'Adjust lighting';
      return;
    }

    if (!this.autoCaptureTriggered && this.imageQuality === 100) {
      this.autoCaptureFeedback = '✓ Auto-capturing...';
      this.captureImage();
      this.autoCaptureTriggered = true;
    }
  }
  
  private cleanup() {
    // Stop animation frame
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    // Stop video stream
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  // Public method for template
  captureImage() {
    if (!this.documentDetected) {
      console.warn('No document detected');
      return;
    }

    const canvas = this.canvasElement.nativeElement;
    const dataUrl = canvas.toDataURL('image/png');
    
    console.log('Document captured');
    
    // Trigger download
    const link = document.createElement('a');
    link.download = `scan-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();

    // Provide user feedback
    this.showCaptureFlash();

    if (this.autoCaptureEnabled) {
      this.autoCaptureTriggered = true;
      this.autoCaptureFeedback = '✓ Auto-captured';
    }
  }

  private showCaptureFlash() {
    const canvas = this.canvasElement.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // White flash effect
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    setTimeout(() => {
      // Flash will be cleared on next frame draw
    }, 100);
  }
}
