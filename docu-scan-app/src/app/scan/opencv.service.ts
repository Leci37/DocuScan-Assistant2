import { Injectable } from '@angular/core';
import {
  APPROX_POLY_EPSILON_FACTOR,
  CANNY_SIGMA,
  GAUSSIAN_BLUR_SIZE,
  MEDIAN_BLUR_SIZE,
  MIN_DOCUMENT_AREA,
  DOCUMENT_CORNER_COUNT,
  OPENCV_CHECK_INTERVAL_MS,
  OPENCV_LOAD_TIMEOUT_MS
} from './scanner-config';

declare const cv: any;

export interface DetectionResult {
  corners: number[] | null;
}

@Injectable({ providedIn: 'root' })
export class OpenCVService {
  private loaded = false;

  async loadOpenCV(): Promise<void> {
    if (this.loaded) {
      return;
    }

    if (typeof cv !== 'undefined' && cv.Mat) {
      this.loaded = true;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('OpenCV.js did not load in time.'));
      }, OPENCV_LOAD_TIMEOUT_MS);

      const checkInterval = setInterval(() => {
        if (typeof cv !== 'undefined' && cv.Mat) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          this.loaded = true;
          resolve();
        }
      }, OPENCV_CHECK_INTERVAL_MS);
    });
  }

  processFrame(videoElement: HTMLVideoElement): DetectionResult {
    if (!this.loaded) {
      throw new Error('OpenCV.js is not loaded');
    }

    if (
      videoElement.readyState !== videoElement.HAVE_ENOUGH_DATA ||
      videoElement.videoWidth === 0 ||
      videoElement.videoHeight === 0
    ) {
      return { corners: null };
    }

    let src: any = null;
    let gray: any = null;
    let blurred: any = null;
    let edges: any = null;
    let contours: any = null;
    let hierarchy: any = null;
    let bestContour: any = null;

    try {
      src = new cv.Mat(videoElement.videoHeight, videoElement.videoWidth, cv.CV_8UC4);
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = videoElement.videoWidth;
      tempCanvas.height = videoElement.videoHeight;
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) {
        return { corners: null };
      }

      tempCtx.drawImage(videoElement, 0, 0, videoElement.videoWidth, videoElement.videoHeight);
      const imageData = tempCtx.getImageData(0, 0, videoElement.videoWidth, videoElement.videoHeight);
      src.data.set(imageData.data);

      gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      blurred = new cv.Mat();
      cv.GaussianBlur(gray, blurred, new cv.Size(GAUSSIAN_BLUR_SIZE, GAUSSIAN_BLUR_SIZE), 0);

      const medianMat = new cv.Mat();
      cv.medianBlur(gray, medianMat, MEDIAN_BLUR_SIZE);
      const medianValue = medianMat.data[Math.floor((medianMat.rows * medianMat.cols) / 2)];
      medianMat.delete();

      const sigma = CANNY_SIGMA;
      const lowerThreshold = Math.max(0, (1.0 - sigma) * medianValue);
      const upperThreshold = Math.min(255, (1.0 + sigma) * medianValue);

      edges = new cv.Mat();
      cv.Canny(blurred, edges, lowerThreshold, upperThreshold);

      contours = new cv.MatVector();
      hierarchy = new cv.Mat();
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let maxArea = 0;

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, APPROX_POLY_EPSILON_FACTOR * peri, true);

        if (approx.rows === DOCUMENT_CORNER_COUNT && area > maxArea && area > MIN_DOCUMENT_AREA) {
          maxArea = area;
          if (bestContour) {
            bestContour.delete();
          }
          bestContour = approx;
        } else {
          approx.delete();
        }
      }

      let corners: number[] | null = null;

      if (bestContour) {
        corners = Array.from(bestContour.data32S as Int32Array);
      }

      return { corners };
    } finally {
      if (bestContour) {
        bestContour.delete();
      }
      if (src) {
        src.delete();
      }
      if (gray) {
        gray.delete();
      }
      if (blurred) {
        blurred.delete();
      }
      if (edges) {
        edges.delete();
      }
      if (contours) {
        contours.delete();
      }
      if (hierarchy) {
        hierarchy.delete();
      }
    }
  }
}
