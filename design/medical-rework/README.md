# Medical onboarding and product rework — 8 September 2026

The interface now opens on real authentication, then health history, program design and a guided workout. It uses the original Azm wordmark, a restrained pearl/ink palette, purple brand accents and gold primary actions. Previous promotional language such as “Arabic-first” and “Private by design” has been removed from the interface.

The original Azm 2.0 condition presets are preserved in `src/medical/legacy-config.ts`, sourced from `/Users/nasser/Development/Azm2.0/server/recommendation/disabilityConfig.ts`. Their structural types were adapted locally. Preset inclusion is provenance, not a new clinical endorsement. The current planner limits output to the three exercises supported by the existing pose engine. It combines conditions conservatively, excludes unsupported movements, checks equipment and recovery spacing, and blocks automatic exercise where review is required. Medication and diagnosis notes are recorded, not interpreted by AI.

Security is implemented by the local application server, not a simulated browser login. Existing Azm 2.0 hosted accounts are not migrated. See the root README for account, deployment and medical-scope limits.

Validation: 52 automated tests; type checking; client and server production build; production account smoke test; development dependency audit with no reported vulnerabilities at completion. Browser visual QA uses a synthetic adult stroke profile and virtual camera, not participant data. Screenshots are at 3×, including Arabic desktop/mobile, intake, program, medical review, guided sets and recovery. No camera pixels or landmarks are sent to the API.

The recording API enforces account ownership, plan versions, ordered sets, bounded metrics and matching rep timelines. Demonstration sets are never saved into personal history. Real set persistence, high-effort termination and recovery checks are independently tested at the API boundary.

Poster screenshots were refreshed in `KSCDR_Hackathon_000_Azm.pptx` and rendered to `KSCDR_Hackathon_000_Azm_preview.png`. Both embedded screenshots are 4320 × 2838 px at approximately 712 DPI in their print frames. Text bodies and fonts were compared unchanged; package integrity and A0 layout checks passed.
