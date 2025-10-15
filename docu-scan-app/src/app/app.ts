import { Component } from '@angular/core';
import { ScannerComponent } from './scanner/scanner.component';
import { ScannerConfig, DEFAULT_SCANNER_CONFIG } from './scanner/scanner.config';
import { ScanResult } from './scanner/models/scan-result.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ScannerComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  readonly scannerConfig: ScannerConfig = { ...DEFAULT_SCANNER_CONFIG };
  lastCapture?: ScanResult;

  onDocumentCaptured(result: ScanResult): void {
    this.lastCapture = result;
    console.info('Document captured', result);
  }
}
