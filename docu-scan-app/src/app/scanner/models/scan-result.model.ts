import { Point, QualityScores } from './corner.model';

export interface ScanResult {
  dataUrl: string;
  width: number;
  height: number;
  capturedAt: number;
  corners: Point[];
  quality: QualityScores;
}
