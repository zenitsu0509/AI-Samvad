declare module '@mediapipe/face_mesh' {
  export class FaceMesh {
    constructor(config?: { locateFile?: (file: string) => string });
    setOptions(options: any): void;
    onResults(cb: (results: any) => void): void;
    send(input: { image: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement }): Promise<void>;
    close?: () => void;
  }
}
