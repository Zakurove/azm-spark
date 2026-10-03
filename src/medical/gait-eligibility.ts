/**
 * Who walks for the gait test today, how and with whom (product v7 contract 2.5; gait-rules
 * eligibility). Pure, no DOM.
 *
 * Step A1 commits the types; gaitPlanFor lands with step A4.
 */

export type GaitMode = "overground" | "walking_pad";
export type GaitNotOffered =
  | "not_walking"
  | "walk_needs_hands_on_help"
  | "restriction"
  | "prosthesis_off"
  | "surgery_not_cleared"
  | "clearance_needed"
  | "pain_today"
  | "global_gate"
  | "red_flag";
export interface GaitPlan {
  offered: boolean;
  reason?: GaitNotOffered;
  /** allowed today */
  modes: GaitMode[];
  /** overground */
  defaultMode: GaitMode;
  /** modeChoice.padAllowedWhenAll */
  padAllowed: boolean;
  helperRequired: boolean;
  /** Leg, hip or back pain 4 or 5 today: only the antalgic label can show (painDayRule). */
  antalgicOnly: boolean;
  /** the single leg stance check (capture.staticSingleLegStance) runs */
  staticStance: boolean;
  /** Views in capture order per mode (capture.walking_pad: the affected side first, then the other side, then the front). */
  views: {
    overground: ("front" | "back" | "side")[];
    walking_pad: { view: "pad_side" | "pad_front"; nearSide?: "left" | "right" }[];
  };
}
