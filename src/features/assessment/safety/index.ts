/**
 * Safety screens and questions S36 to S49 (the safety stream), and the overlays over the camera
 * states: the stop list S41 and the optional check in S43 (D-016).
 *
 *   S36 to S40b  SafetyScreen (emergency, AD, faint, fall, seek care, pain), no Back and no Exit
 *   S38b         FaintAsk, the faint follow up after a faint or a fall stop
 *   S41          StopList                S42   StopDone
 *   S43          CheckIn
 *   S46          SkipNotice              S46b  GuestAfterTest
 *   S47          Between                 S48   AfterTest      S49   EndQuestion
 *
 * Every safety screen is spoken in full (under the O12 (4) interim gate for the Arabic body, speech.ts)
 * and never waits for the network: routing, locks and timers run on the phone.
 */
import type { SafetyScreenId, ScreenComponent } from "../screenTypes";
import { CheckIn } from "./CheckIn";
import { GuestAfterTest, SkipNotice, StopDone } from "./Notices";
import { AfterTest, Between, EndQuestion, FaintAsk } from "./Questions";
import { SafetyScreen } from "./SafetyScreen";
import { StopList } from "./StopList";
import "./safety.css";

export const SAFETY_SCREENS: Record<SafetyScreenId, ScreenComponent> = {
  S36: SafetyScreen,
  S37: SafetyScreen,
  S38: SafetyScreen,
  S38b: FaintAsk,
  S39: SafetyScreen,
  S40a: SafetyScreen,
  S40b: SafetyScreen,
  S41: StopList,
  S42: StopDone,
  S43: CheckIn,
  S46: SkipNotice,
  S46b: GuestAfterTest,
  S47: Between,
  S48: AfterTest,
  S49: EndQuestion,
};
