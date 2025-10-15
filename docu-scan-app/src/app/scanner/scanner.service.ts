import { Injectable } from '@angular/core';
import { DEFAULT_SCANNER_CONFIG, ScannerConfig } from './scanner.config';
import { Point } from './models/corner.model';

declare const cv: any;

interface DocumentDetectionResult {
  corners: Point[];
  areaRatio: number;
  isValid: boolean;
}

@Injectable({ providedIn: 'root' })
export class ScannerService {
  private readonly cannySigma = 0.33;
  private readonly minAngleDegrees = 20;

  detectDocument(frame: any, config: ScannerConfig = DEFAULT_SCANNER_CONFIG): DocumentDetectionResult | null {
    if (!frame || !frame.cols || !frame.rows) {
      return null;
    }

    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const edges = new cv.Mat();
    const hierarchy = new cv.Mat();
    const contours = new cv.MatVector();

    try {
      cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      const medianValue = this.computeMedian(gray);
      const lower = Math.max(0, (1.0 - this.cannySigma) * medianValue);
      const upper = Math.min(255, (1.0 + this.cannySigma) * medianValue);

      cv.Canny(blurred, edges, lower, upper);
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      let bestResult: DocumentDetectionResult | null = null;
      const frameArea = frame.cols * frame.rows;

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        const areaRatio = area / frameArea;

        if (areaRatio < config.minDocumentArea || areaRatio > config.maxDocumentArea) {
          contour.delete();
          continue;
        }

        const peri = cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);

        if (approx.rows !== 4 || !cv.isContourConvex(approx)) {
          approx.delete();
          contour.delete();
          continue;
        }

        const corners = this.matToPoints(approx);
        const ordered = this.orderCorners(corners);

        if (!this.isValidQuadrilateral(ordered)) {
          approx.delete();
          contour.delete();
          continue;
        }

        const candidate: DocumentDetectionResult = {
          corners: ordered,
          areaRatio,
          isValid: true,
        };

        if (!bestResult || candidate.areaRatio > bestResult.areaRatio) {
          if (bestResult) {
            // nothing to delete, we only keep primitive data
          }
          bestResult = candidate;
        }

        approx.delete();
        contour.delete();
      }

      return bestResult;
    } finally {
      gray.delete();
      blurred.delete();
      edges.delete();
      hierarchy.delete();
      contours.delete();
    }
  }

  calculateSharpness(frame: any): number {
    const gray = new cv.Mat();
    const laplacian = new cv.Mat();
    const mean = new cv.Mat();
    const stddev = new cv.Mat();

    try {
      cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);
      cv.Laplacian(gray, laplacian, cv.CV_64F);
      cv.meanStdDev(laplacian, mean, stddev);
      const variance = Math.pow(stddev.data64F[0], 2);
      return this.normalizeVarianceToScore(variance);
    } finally {
      gray.delete();
      laplacian.delete();
      mean.delete();
      stddev.delete();
    }
  }

  calculateLightingQuality(frame: any): number {
    const gray = new cv.Mat();
    const mean = new cv.Mat();
    const stddev = new cv.Mat();

    try {
      cv.cvtColor(frame, gray, cv.COLOR_RGBA2GRAY);
      cv.meanStdDev(gray, mean, stddev);

      const meanBrightness = mean.data64F[0];
      const contrast = stddev.data64F[0];

      const totalPixels = gray.rows * gray.cols;
      let darkPixels = 0;
      let brightPixels = 0;
      const data = gray.data;
      for (let i = 0; i < data.length; i++) {
        if (data[i] <= 5) {
          darkPixels++;
        } else if (data[i] >= 250) {
          brightPixels++;
        }
      }

      const darkRatio = darkPixels / totalPixels;
      const brightRatio = brightPixels / totalPixels;

      let score = 100;

      if (meanBrightness < 80) {
        score -= Math.min(60, (80 - meanBrightness) * 0.8);
      } else if (meanBrightness > 180) {
        score -= Math.min(60, (meanBrightness - 180) * 0.6);
      }

      if (contrast < 40) {
        score -= Math.min(50, (40 - contrast) * 1.0);
      } else if (contrast > 110) {
        score -= Math.min(20, (contrast - 110) * 0.3);
      }

      if (darkRatio > 0.05) {
        score -= Math.min(40, (darkRatio - 0.05) * 400);
      }

      if (brightRatio > 0.05) {
        score -= Math.min(40, (brightRatio - 0.05) * 400);
      }

      return Math.max(0, Math.min(100, Math.round(score)));
    } finally {
      gray.delete();
      mean.delete();
      stddev.delete();
    }
  }

  orderCorners(points: Point[]): Point[] {
    if (points.length !== 4) {
      return points;
    }

    const sorted = [...points];
    sorted.sort((a, b) => a.y - b.y || a.x - b.x);
    const [p0, p1, p2, p3] = sorted;

    const topLeft = p0.x < p1.x ? p0 : p1;
    const topRight = p0.x < p1.x ? p1 : p0;
    const bottomLeft = p2.x < p3.x ? p2 : p3;
    const bottomRight = p2.x < p3.x ? p3 : p2;

    return [topLeft, topRight, bottomRight, bottomLeft];
  }

  private matToPoints(mat: any): Point[] {
    const points: Point[] = [];
    for (let i = 0; i < mat.rows; i++) {
      const x = mat.data32S[i * 2];
      const y = mat.data32S[i * 2 + 1];
      points.push({ x, y });
    }
    return points;
  }

  private computeMedian(gray: any): number {
    const total = gray.rows * gray.cols;
    const step = Math.max(1, Math.floor(total / 5000));
    const values: number[] = [];
    for (let i = 0; i < total; i += step) {
      values.push(gray.data[i]);
    }
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] || 0;
  }

  private normalizeVarianceToScore(variance: number): number {
    if (variance >= 500) {
      return 100;
    }
    if (variance <= 50) {
      return 0;
    }
    if (variance < 200) {
      const ratio = (variance - 50) / (200 - 50);
      return Math.max(0, Math.round(ratio * 50));
    }
    const ratio = (variance - 200) / (500 - 200);
    return Math.min(100, Math.round(50 + ratio * 50));
  }

  private isValidQuadrilateral(points: Point[]): boolean {
    if (points.length !== 4) {
      return false;
    }

    // Ensure area is positive
    const area = this.polygonArea(points);
    if (area < 1000) {
      return false;
    }

    for (let i = 0; i < 4; i++) {
      const a = points[i];
      const b = points[(i + 1) % 4];
      const c = points[(i + 2) % 4];
      const angle = this.angleBetween(a, b, c);
      if (angle < this.minAngleDegrees || angle > 180 - this.minAngleDegrees) {
        return false;
      }
    }

    return true;
  }

  private polygonArea(points: Point[]): number {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      area += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    return Math.abs(area / 2);
  }

  private angleBetween(a: Point, b: Point, c: Point): number {
    const ab = { x: a.x - b.x, y: a.y - b.y };
    const cb = { x: c.x - b.x, y: c.y - b.y };

    const dot = ab.x * cb.x + ab.y * cb.y;
    const magAb = Math.sqrt(ab.x * ab.x + ab.y * ab.y);
    const magCb = Math.sqrt(cb.x * cb.x + cb.y * cb.y);

    const cosine = dot / (magAb * magCb + 1e-6);
    return (Math.acos(Math.min(Math.max(cosine, -1), 1)) * 180) / Math.PI;
  }
}
