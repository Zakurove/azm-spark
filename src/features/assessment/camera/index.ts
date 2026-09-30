/**
 * The camera sequence of one test, S34 (owned by the camera stream): setup check, calibrate, practice,
 * countdown, live measure, saved, retry, rest and next side, all on one CameraStage. Pose frames come
 * from createCheckPoseSource (../poseSourceFactory.ts): the camera with numPoses 2, or the E2E fixture
 * source on a VITE_E2E build.
 */
import type { CameraScreenId, ScreenComponent } from "../screenTypes";
import { CameraScreen } from "./CameraScreen";

export const CAMERA_SCREENS: Record<CameraScreenId, ScreenComponent> = {
  S34: CameraScreen,
};

export { CameraStage } from "./CameraStage";
