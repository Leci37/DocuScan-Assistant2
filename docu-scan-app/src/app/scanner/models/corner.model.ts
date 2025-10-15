export interface Point {
  x: number;
  y: number;
}

export interface Quadrilateral {
  points: Point[];
  area: number;
}

export interface CornerHistory {
  frame: number;
  corners: Point[];
  timestamp: number;
}

export interface QualityScores {
  overall: number;
  stability: number;
  sharpness: number;
  lighting: number;
}

export type CaptureAnimationPhase = 'idle' | 'pre' | 'flash' | 'post';
