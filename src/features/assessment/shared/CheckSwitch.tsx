/**
 * A setting switch: a 48 px button with role switch, its title, an optional note under it, and the
 * track. Used by S14's optional check in (D-016) and the booth staff settings (S55).
 */
import type { ReactNode } from "react";

export interface CheckSwitchProps {
  on: boolean;
  onChange(on: boolean): void;
  title: string;
  note?: string;
  icon?: ReactNode;
  /** Names the setting for tests and the page (data-setting). */
  setting?: string;
}

export function CheckSwitch({ on, onChange, title, note, icon, setting }: CheckSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="check-switch"
      data-setting={setting}
      onClick={() => onChange(!on)}
    >
      {icon}
      <span className="check-switch-text">
        <span className="check-switch-title">{title}</span>
        {note && <span className="check-meta">{note}</span>}
      </span>
      <span className="check-switch-track" aria-hidden="true">
        <span />
      </span>
    </button>
  );
}
