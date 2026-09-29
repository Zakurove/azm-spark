/**
 * The camera sequence of one test, S34 (owned by the camera stream): setup check, calibrate, practice,
 * countdown, live measure, saved, retry, rest and next side, all on one CameraStage. Pose frames come
 * from createCheckPoseSource (../poseSourceFactory.ts): the camera with numPoses 2, or the E2E fixture
 * source on a VITE_E2E build.
 *
 * useCameraWatch is for the answer screens over the camera (S29 practice check, S47, S48): it keeps the
 * camera on and the check in armed as the arming table asks (UX spec 4.8).
 */
import type { CameraScreenId, ScreenComponent } from "../screenTypes";
import { CameraScreen } from "./CameraScreen";

export const CAMERA_SCREENS: Record<CameraScreenId, ScreenComponent> = {
  S34: CameraScreen,
};

export { useCameraWatch } from "./watch";
export { CameraStage } from "./CameraStage";
