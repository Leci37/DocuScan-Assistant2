import { Component, ElementRef, ViewChild, OnDestroy, OnInit, PLATFORM_ID, Inject } from '@angular/core';
import { isPlatformBrowser, CommonModule } from '@angular/common';

declare var cv: any;

@Component({
  selector: 'app-scan',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './scan.component.html',
  styleUrls: ['./scan.component.css']
})
export class ScanComponent implements OnInit, OnDestroy {
  @ViewChild('video', { static: true }) videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvas', { static: true }) canvasElement!: ElementRef<HTMLCanvasElement>;

  private stream: MediaStream | null = null;
  private animationId: number | null = null;
  private isProcessing = false;
  private opencvLoaded = false;

  // Public properties for template
  documentDetected = false;
  private detectionStableCount = 0;
  private readonly STABLE_THRESHOLD = 5; // Number of consecutive frames needed

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {}

  async ngOnInit() {
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

    // Verify video is playing and has valid dimensions
    if (video.readyState !== video.HAVE_ENOUGH_DATA || 
        video.videoWidth === 0 || 
        video.videoHeight === 0) {
      return;
    }

    let src: any = null;
    let gray: any = null;
    let blurred: any = null;
    let edges: any = null;
    let hierarchy: any = null;
    let contours: any = null;

    try {
      // Create Mat from video frame - CRITICAL: use exact video dimensions
      src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
      
      // Create a temporary canvas to capture video frame
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = video.videoWidth;
      tempCanvas.height = video.videoHeight;
      const tempCtx = tempCanvas.getContext('2d');
      
      if (!tempCtx) return;
      
      // Draw video frame to temporary canvas
      tempCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);
      
      // Get image data and convert to Mat
      const imageData = tempCtx.getImageData(0, 0, video.videoWidth, video.videoHeight);
      src.data.set(imageData.data);

      // Convert to grayscale
      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      // Apply Gaussian blur to reduce noise
      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      // Edge detection using Canny
      edges = new cv.Mat();
      cv.Canny(blurred, edges, 50, 150);

      // Find contours
      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      // Clear canvas and draw video frame
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Find the largest rectangular contour
      let maxArea = 0;
      let bestContour: any = null;

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();

        cv.approxPolyDP(contour, approx, 0.02 * peri, true);

        // Look for quadrilaterals with significant area
        if (approx.rows === 4 && area > maxArea && area > 10000) {
          maxArea = area;
          if (bestContour) bestContour.delete();
          bestContour = approx;
        } else {
          approx.delete();
        }
      }

      // Update document detection status
      if (bestContour) {
        this.detectionStableCount++;
        
        // Document is considered detected when stable for multiple frames
        if (this.detectionStableCount >= this.STABLE_THRESHOLD) {
          this.documentDetected = true;
        }

        // Draw the detected document outline
        ctx.strokeStyle = this.documentDetected ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 0, 0.8)';
        ctx.lineWidth = 4;
        ctx.fillStyle = this.documentDetected ? 'rgba(0, 255, 0, 0.2)' : 'rgba(255, 255, 0, 0.2)';

        ctx.beginPath();
        const firstPoint = bestContour.data32S;
        ctx.moveTo(firstPoint[0], firstPoint[1]);

        for (let i = 1; i < 4; i++) {
          ctx.lineTo(firstPoint[i * 2], firstPoint[i * 2 + 1]);
        }

        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Draw corner circles
        ctx.fillStyle = this.documentDetected ? 'rgba(0, 255, 0, 0.8)' : 'rgba(255, 255, 0, 0.8)';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(firstPoint[i * 2], firstPoint[i * 2 + 1], 8, 0, 2 * Math.PI);
          ctx.fill();
        }

        bestContour.delete();
      } else {
        // No document detected, reset counters
        this.detectionStableCount = 0;
        this.documentDetected = false;
      }

    } catch (error) {
      console.error('Error in detectDocument:', error);
      this.documentDetected = false;
    } finally {
      // Clean up all OpenCV objects
      if (src) src.delete();
      if (gray) gray.delete();
      if (blurred) blurred.delete();
      if (edges) edges.delete();
      if (hierarchy) hierarchy.delete();
      if (contours) contours.delete();
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