# Angular Document Scanner 📸

An enterprise-ready Angular component that turns any modern browser into a smart document scanner. It combines the device camera with OpenCV.js to deliver real-time document detection, adaptive quality scoring, and intelligent auto-capture animations reminiscent of native scanning apps.

---

## ✨ Highlights

- **Real-time edge detection** with adaptive Canny thresholds and contour validation.
- **Quality scoring engine** that evaluates stability, sharpness, and lighting on every frame.
- **Intelligent auto-capture** once optimal conditions are maintained for a configurable duration.
- **Immersive visual feedback** using a synchronized canvas overlay, countdown indicator, and capture animation.
- **Perspective-corrected exports** that deliver a flattened, ready-to-use document image.

---

## 🚀 Getting Started

### 1. Install dependencies

```bash
cd docu-scan-app
npm install
```

### 2. Include OpenCV.js

Add the OpenCV.js script tag to `src/index.html` so it loads before the Angular bundle:

```html
<script async src="https://docs.opencv.org/4.x/opencv.js"></script>
```

For offline deployments host the file yourself and adjust the URL accordingly.

### 3. Run the development server

```bash
npm start
```

Visit `http://localhost:4200` and grant camera permissions when prompted.

> **Tip:** On mobile devices open the same URL over HTTPS or via a tunnelling solution (e.g. `ngrok`) because many browsers only expose the camera over secure origins.

---

## 🧩 Component Integration

The scanner is delivered as a standalone Angular component located at `src/app/scanner`.

```html
<!-- app.component.html -->
<app-scanner
  [config]="scannerConfig"
  (documentCaptured)="handleCapture($event)"
></app-scanner>
```

```ts
// app.component.ts
import { Component } from '@angular/core';
import { DEFAULT_SCANNER_CONFIG, ScannerConfig } from './scanner/scanner.config';
import { ScanResult } from './scanner/models/scan-result.model';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.html',
})
export class AppComponent {
  scannerConfig: ScannerConfig = { ...DEFAULT_SCANNER_CONFIG };

  handleCapture(result: ScanResult) {
    console.log('Document captured!', result);
  }
}
```

The component emits a `ScanResult` object that contains the flattened PNG data URL, capture timestamp, detected corners, and the quality breakdown at the moment of capture.

---

## ⚙️ Configuration

Tweak behaviour via the `ScannerConfig` interface (`src/app/scanner/scanner.config.ts`).

| Option | Description | Default |
| ------ | ----------- | ------- |
| `autoCapture` | Enables the auto-capture workflow when quality is high. | `true` |
| `captureThreshold` | Minimum overall score (0-100) required to start the countdown. | `85` |
| `captureDelay` | Duration (ms) the score must stay above the threshold before capturing. | `3000` |
| `showScore` | Toggle the score heads-up display. | `true` |
| `showSubScores` | Show per-metric breakdown under the score. | `true` |
| `minDocumentArea` | Reject contours smaller than this fraction of the frame. | `0.2` |
| `maxDocumentArea` | Reject contours larger than this fraction of the frame. | `0.95` |
| `enableSound` | Play a synthetic shutter sound during capture. | `false` |
| `captureAnimation` | Placeholder for switching animation styles (`flash`, `ripple`, `shutter`, `collapse`). | `'flash'` |
| `frameProcessingRate` | Process every _n_-th frame (1 = every frame). Increase to lighten CPU load. | `1` |

---

## 🧠 How It Works

1. **Frame acquisition** – camera frames are downscaled (max 640px width) for processing while the full-resolution feed remains onscreen.
2. **Edge detection** – frames pass through grayscale → Gaussian blur → adaptive Canny → contour detection. Candidate contours are filtered by area, convexity, and polygonal approximation.
3. **Quality scoring** – every frame receives stability (40%), sharpness (35%), and lighting (25%) scores that are combined into the real-time quality index.
4. **Auto-capture** – when the score stays above the threshold, a countdown circle animates. On completion the component flashes, plays an optional shutter tone, and emits the perspective-corrected document.
5. **Capture animation** – the overlay polygon pulses green, turns blue during capture, flashes white, collapses to the centre, and shows a confirmation badge.

---

## 🛠 Performance Tips

- **Adjust `frameProcessingRate`** to skip frames on low-powered devices (e.g. set to `2` to process every other frame).
- **Limit camera resolution** via `getUserMedia` constraints if you notice thermal throttling on mobile.
- **Leverage Web Workers** for OpenCV if you need to free up the main thread—`ScannerService` encapsulates the processing pipeline for easy extraction.
- **Reuse Mats** when extending functionality; always call `.delete()` on OpenCV matrices you create to avoid memory leaks.

---

## 🌐 Browser Compatibility

| Browser | Desktop | Mobile |
| ------- | ------- | ------ |
| Chrome  | ✅ | ✅ |
| Edge (Chromium) | ✅ | ✅ |
| Firefox | ✅ (camera requires HTTPS) | ⚠️ (auto-focus support varies) |
| Safari  | ✅ (macOS 14+) | ✅ (iOS 15+) |

> **Note:** Camera APIs are generally blocked on insecure origins. Always deploy behind HTTPS in production.

---

## 🧪 Testing Checklist

- Camera permission granted and live preview visible.
- Polygon tracks a sheet of paper in real time.
- Score rises/falls with movement, lighting, and focus changes.
- Countdown triggers when the score remains above the threshold.
- Captured image is cropped and perspective-corrected.

---

## 📚 Further Ideas

- Export multiple pages and assemble a PDF.
- Add document classification (receipts vs. photos) before saving.
- Move processing into a Web Worker for even smoother UI.
- Persist captured documents to IndexedDB for offline use.

Happy scanning! 🧾✨
