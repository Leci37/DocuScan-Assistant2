export interface ScannerConfig {
  autoCapture: boolean;
  captureThreshold: number;
  captureDelay: number;
  showScore: boolean;
  showSubScores: boolean;
  minDocumentArea: number;
  maxDocumentArea: number;
  enableSound: boolean;
  captureAnimation: 'flash' | 'ripple' | 'shutter' | 'collapse';
  frameProcessingRate: number;
}

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  autoCapture: true,
  captureThreshold: 85,
  captureDelay: 3000,
  showScore: true,
  showSubScores: true,
  minDocumentArea: 0.2,
  maxDocumentArea: 0.95,
  enableSound: false,
  captureAnimation: 'flash',
  frameProcessingRate: 1,
};
