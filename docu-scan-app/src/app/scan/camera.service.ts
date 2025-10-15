import { Injectable } from '@angular/core';
import { CAMERA_IDEAL_HEIGHT, CAMERA_IDEAL_WIDTH, CAMERA_READY_DELAY_MS } from './scanner-config';

@Injectable({ providedIn: 'root' })
export class CameraService {
  async startCamera(videoElement: HTMLVideoElement): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Media devices API is not supported in this browser.');
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: CAMERA_IDEAL_WIDTH },
        height: { ideal: CAMERA_IDEAL_HEIGHT }
      }
    });

    videoElement.srcObject = stream;

    await new Promise<void>((resolve) => {
      videoElement.onloadedmetadata = () => {
        void videoElement.play();
        resolve();
      };
    });

    if (CAMERA_READY_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, CAMERA_READY_DELAY_MS));
    }

    return stream;
  }

  stopStream(stream: MediaStream): void {
    stream.getTracks().forEach(track => track.stop());
  }
}
