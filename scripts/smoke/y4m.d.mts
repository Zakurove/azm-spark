/** Types for scripts/smoke/y4m.mjs (the Y4M helpers of the real model smoke harness, contract 8.4). */
export interface Y4mArgsOptions {
  input: string;
  output: string;
  fps?: number;
  width?: number;
  height?: number;
  start?: number;
  seconds?: number;
}
export declare function y4mArgs(options: Y4mArgsOptions): string[];
export interface Y4mHeader {
  width: number;
  height: number;
  fps: number;
  fpsRatio: [number, number];
  interlace: string;
  chroma: string;
}
export declare function parseY4mHeader(line: string): Y4mHeader;
export declare function y4mProblems(header: Y4mHeader): string[];
export declare function y4mFrameBytes(width: number, height: number): number;
export declare function y4mFrameCount(fileSize: number, headerBytes: number, width: number, height: number): number;
export interface Y4mInfo {
  header: Y4mHeader;
  headerBytes: number;
  frames: number;
  seconds: number;
  bytes: number;
  problems: string[];
}
export declare function readY4mInfo(file: string): Y4mInfo;
