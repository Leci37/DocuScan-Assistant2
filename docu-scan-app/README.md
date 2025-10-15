# DocuScan Angular 📸: Live Document Scanner

This project is an Angular component that implements a live document scanner, similar to the functionality found in apps like Google Drive or Microsoft Lens. It uses **OpenCV.js** to perform real-time edge detection on a live camera stream and overlays a polygon to guide the user.

The component also includes an advanced **auto-capture feature** that triggers the scan automatically when the camera is steady, the image is sharp, and the lighting is adequate.

-----

## Features

  * **Live Camera Preview**: Displays a real-time feed from the user's camera.
  * **Real-Time Edge Detection**: Processes video frames to find the corners of a document.
  * **Highlight Overlay**: Draws a colored polygon over the `<canvas>` element to visualize the detected edges.
  * **Auto-Capture Logic**: Automatically captures the image when the following conditions are met:
      * **Edge Stability**: The detected corners remain stable for several frames.
      * **Image Sharpness**: The image is in focus, calculated using a Variance of Laplacian algorithm.
      * **Good Lighting**: The image histogram indicates proper exposure (not too dark or bright).

-----

## Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

  * Node.js and npm
  * Angular CLI (`npm install -g @angular/cli`)




## Development Instructions

Here is a summary of the steps we have completed so far to get the live document scanner running.

### 1\. Project Setup

  * **Install Angular CLI:** If you haven't already, install the Angular Command Line Interface globally.
    ```bash
    npm install -g @angular/cli
    ```
  * **Create Angular Project:** Navigate to your GitHub directory and create the new project.
    ```bash
    cd C:\Users\llecinana\Documents\GitHub\DocuScan-Assistant2
    ng new docu-scan-app
    ```
  * **Navigate into Project:** Move into the newly created project directory before running any other commands.
    ```bash
    cd docu-scan-app
    ```

### 2\. Add OpenCV.js

  * Include the OpenCV.js library in your project by adding the script tag to the `<head>` of your `src/index.html` file.
    ```html
    <script async src="https://docs.opencv.org/4.x/opencv.js"></script>
    ```

### 3\. Create the Scanner Component

  * Generate a new component named `scan` using the Angular CLI. This will house all the logic for our scanner.
    ```bash
    ng generate component scan
    ```

### 4\. Implement the Component

  * **HTML (`src/app/scan/scan.component.html`):** Set up the video and canvas elements.
    ```html
    <div class="scanner-container">
      <video #video autoplay playsinline></video>
      <canvas #canvasOverlay></canvas>
    </div>
    ```
  * **CSS (`src/app/scan/scan.component.css`):** Style the component to overlay the canvas on top of the video feed.
    ```css
    .scanner-container {
      position: relative;
    }
    canvas {
      position: absolute;
      top: 0;
      left: 0;
    }
    ```
  * **TypeScript (`src/app/scan/scan.component.ts`):** Add the core logic to access the camera, process the video frames with OpenCV.js, and draw the detected document edges on the canvas. *(Refer to the complete code we created in the previous step)*.

### 5\. Display the Component

  * Clear the contents of `src/app/app.component.html` and add the selector for your new scan component.
    ```html
    <app-scan></app-scan>
    ```

### 6\. Run the Application

  * Start the local development server from within the `docu-scan-app` directory.
    ```bash
    ng serve
    ```
  * Open your browser and navigate to `http://localhost:4200` to see the live document scanner in action.