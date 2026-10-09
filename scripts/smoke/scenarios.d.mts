/** Types for scripts/smoke/scenarios.mjs (the smoke video scenarios and their truth, contract 8.4). */
import type { Camera, Pose, SceneProps, Skeleton } from "./humanoid.mjs";

export interface Scenario {
  id: string;
  kind: "rom" | "gait";
  width: number;
  height: number;
  fps: number;
  seconds: number;
  loops: boolean;
  camera: Camera;
  scene: SceneProps;
  poseAt(t: number): Pose;
  /** The time frame i is drawn at (the home walks' jitter); default i / fps. */
  sampleAt?(i: number): number;
  /** The pose the truth reads, without the person's jitter (D-035 rom-mvp-*); absent: poseAt. */
  truthPoseAt?: (t: number) => Pose;
  meta: Record<string, unknown>;
}
export interface RomScenario extends Scenario {
  kind: "rom";
}
export interface GaitScenario extends Scenario {
  kind: "gait";
}
export declare const SCENARIOS: Readonly<{
  "rom-shoulder-abduction-right": RomScenario;
  "gait-pad-side": GaitScenario;
  "gait-home-side": GaitScenario;
  "gait-home-wall": GaitScenario;
  "rom-seated-shoulder-flexion-right": RomScenario;
  "rom-seated-shoulder-flexion-right-150": RomScenario;
  "rom-seated-shoulder-abduction-right": RomScenario;
  "rom-seated-elbow-flexion-right": RomScenario;
  "rom-mvp-shoulder-flexion-drift-right": RomScenario;
  "rom-mvp-elbow-flexion-right": RomScenario;
  "rom-mvp-knee-extension-right": RomScenario;
  "rom-mvp-elbow-extension-right": RomScenario;
}>;
export declare function movementTruthDeg(movement: string, skel: Skeleton, side: "left" | "right"): number;
export declare function framePoints(sc: Scenario, skel: Skeleton): { x: number; y: number; depth: number }[];

interface TruthBase {
  id: string;
  fps: number;
  width: number;
  height: number;
  seconds: number;
  loops: boolean;
  camera: Camera;
  source: string;
  notes: string;
}
export interface RomTruth extends TruthBase {
  kind: "rom";
  movement: string;
  side: "left" | "right";
  position: string;
  view: string;
  startDeg: number;
  endDeg: number;
  holds: { from: number; to: number; deg: number }[];
  phases: Record<string, [number, number]>;
  projected: { startDeg: number; endDeg: number };
  /** The smoke page's query when it is not the movement's own (D-035: answer=none). */
  smokeQuery?: string;
}
export interface GaitEventTruth {
  side: "left" | "right";
  type: "ic" | "to";
  t: number;
}
export interface GaitTruth extends TruthBase {
  kind: "gait";
  view: string;
  mode: string;
  nearSide: "left" | "right";
  cadenceSpm: number;
  strideTimeS: number;
  stancePct: number;
  padSpeedKmh: number;
  heightCm: number;
  standing: { from: number; to: number };
  walk: { from: number; to: number };
  strides: { left: number; right: number };
  events: GaitEventTruth[];
  /** The walks at home (D-035): the walk lab's view; their truths have no pad fields. */
  lab?: "side" | "front";
  passes?: { from: number; to: number }[];
  jitterMs?: number;
}
export type Truth = RomTruth | GaitTruth;
export declare function scenarioTruth(sc: RomScenario): RomTruth;
export declare function scenarioTruth(sc: GaitScenario): GaitTruth;
export declare function scenarioTruth(sc: Scenario): Truth;
export declare function smokeQuery(truth: Truth): string;
export declare function feetDown(sc: Scenario, t: number): { left: boolean; right: boolean };
