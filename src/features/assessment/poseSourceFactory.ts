/**
 * The pose source of the check's camera screens (contract v2 F, v3 K): the camera with up to two
 * people (CHECK_DATA.engine.pose.numPoses, SubjectLock picks the subject), or, on a VITE_E2E=1 build
 * only, the fixture source chosen by ?e2eFixture=<name>. The E2E branch is removed from the
 * production build, since VITE_E2E is replaced at build time.
 */
import { CameraPoseSource, type PoseSource } from "../../app/poseSource";
import { CHECK_DATA } from "../../movements/assessments";

export async function createCheckPoseSource(video: HTMLVideoElement): Promise<PoseSource> {
  if (import.meta.env.VITE_E2E === "1") {
    const name = new URLSearchParams(location.search).get("e2eFixture");
    if (name) {
      const { FixturePoseSource } = await import("./e2e/FixturePoseSource");
      return new FixturePoseSource(name);
    }
  }
  return new CameraPoseSource(video, { numPoses: CHECK_DATA.engine.pose.numPoses });
}
