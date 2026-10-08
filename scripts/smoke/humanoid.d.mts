/** Types for scripts/smoke/humanoid.mjs (the procedural humanoid of the smoke videos, contract 8.4). */
export type Vec3 = [number, number, number];
export type Sided = { l: number; r: number };
export declare const J: Readonly<{
  PELVIS: 0;
  HIP_L: 1;
  HIP_R: 2;
  KNEE_L: 3;
  KNEE_R: 4;
  ANK_L: 5;
  ANK_R: 6;
  HEEL_L: 7;
  HEEL_R: 8;
  TOE_L: 9;
  TOE_R: 10;
  NECK: 11;
  HEAD: 12;
  SH_L: 13;
  SH_R: 14;
  ELB_L: 15;
  ELB_R: 16;
  WR_L: 17;
  WR_R: 18;
  HAND_L: 19;
  HAND_R: 20;
}>;
export declare const JOINT_COUNT: 21;
export declare const BODY: Readonly<{
  thigh: number;
  shank: number;
  upperArm: number;
  foreArm: number;
  hand: number;
  hipHalf: number;
  shoulderHalf: number;
  trunk: number;
  neckToHead: number;
  thighRadius: number;
  sole: number;
}>;
export interface Pose {
  fwd: Vec3;
  at: [number, number];
  floorY?: number;
  hip: Sided;
  knee: Sided;
  ankle: Sided;
  shoulderAbd?: Sided;
  shoulderFlex?: Sided;
  elbow?: Sided;
  trunkLean?: number;
  headPitch?: number;
}
export interface Skeleton {
  joints: Vec3[];
  headF: Vec3;
  headU: Vec3;
  trunkF: Vec3;
  right: Vec3;
  seatY: number | null;
  /** The lowest sole point of each foot, metres. */
  soleY: Sided;
}
export interface Camera {
  pos: Vec3;
  target: Vec3;
  fovY: number;
}
export interface SceneProps {
  chair?: boolean;
  pad?: { deck: number; length: number; width: number } | null;
  wall?: Vec3;
  floor?: Vec3;
  wallZ?: number;
}
export declare function standingPose(fwd: Vec3, at?: [number, number]): Required<Pose>;
export declare function skeleton(pose: Pose): Skeleton;
export declare function armAbductionDeg(skel: Skeleton, side: "left" | "right"): number;
export declare function elbowFlexionDeg(skel: Skeleton, side: "left" | "right"): number;
export declare function project(point: Vec3, cam: Camera, w: number, h: number): { x: number; y: number; depth: number };
export declare function createRenderer(canvas: HTMLCanvasElement): {
  gl: WebGL2RenderingContext;
  render(skel: Skeleton, cam: Camera, scene?: SceneProps): void;
};
