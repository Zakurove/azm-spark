# Gait fixtures

Test data for the v7 gait engine and gait rules (product v7 contract 8.3, stream C, step C2). Never
shipped: the e2e pose source plays the synthetic walks by name, and the unit tests read the rest.

- `gen-gait.ts`: a synthetic walker seen by a phone, with exactly known events, in the five views
  (side, front toward, back away, walking pad side and front), with noise, jitter, dropped frames,
  label swaps, occlusions, stratified pass starts and the pattern modifiers (below).
- `catalog.ts`: the named synthetic walks the e2e `FixturePoseSource` plays
  (`?e2eFixture=gait/<name>`, the standing calibration first), the speed and cadence pairs of the
  sweep, and the pattern walks of the acceptance.
- `mocap/*.mocap` and `mocap.ts`: real walks from two open motion capture datasets, projected
  through the same phone as the synthetic walker (below). Node only: never in a browser bundle.

The acceptance of contract 8.3 is `tests/v7/c-acceptance-synthetic.test.ts`,
`c-acceptance-patterns.test.ts` and `c-acceptance-mocap.test.ts`; `c-mocap-report.test.ts`
writes the stroke survivors' rule hits for the clinical review.

## Synthetic walker

C1's walker places each foot on its path (heel rocker, flat foot, toe rocker, a swing that brakes
before contact) and finds the knees by two bone inverse kinematics, so its contacts and toe offs are
exact. Its pattern modifiers, each per side and off by default (a walk without them is C1's walk
byte for byte), change the walk the way a gait-rules 5 pattern does:

| Modifier                                       | What it changes                                                    | Pattern walks                     |
| ---------------------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| `stanceBy`                                     | a leg's stance share, so the other side's single support           | shorter stance                    |
| `pelvicDrop`, `trunkLean`                      | the swing side's hip drop, the trunk's lean toward the stance side | Trendelenburg, Duchenne, waddling |
| `swingKnee`, `liftBy`, `toeOffPitch`           | the knee's bend in swing (the pelvis vaults over the other foot)   | stiff knee                        |
| `highStep`, `contactPitch`                     | a foot carried high late in swing and landing flat or toe first    | steppage                          |
| `stanceKnee`                                   | the knee held bent, or past straight, through single stance        | crouch, recurvatum                |
| `loadingKnee`                                  | the knee kept straight at landing                                  | quadriceps avoidance              |
| `contactShift`, `pelvisLag`                    | where a foot lands, how far the pelvis has come                    | reduced extension                 |
| `speed`, `cadence`, `armSwing`, `trunkForward` | short quick steps, a small arm swing, a forward trunk              | short steps                       |

The contract asked for a walker driven by the Van Criekinge able bodied mean joint angle curves.
C1's foot path walker is kept (its exact events are what C1's tests rest on); the projected Van
Criekinge and Fukuchi walks below are the curve driven walks, each with its own real joint angles.

## Motion capture fixtures

Each file is one walker, JSON text named `<id>.mocap` (`tests/fixtures.test.ts` reads every `.json`
under `tests/fixtures` as a movement check fixture): the room coordinates (millimetres) of the 19
points that stand in for the
MediaPipe landmarks the gait engine reads, at 30 Hz with frame time jitter, the standing calibration
from the dataset's static trial, and the dataset's own gait events as the truth. `mocap.ts` places
the phone for any view and projects every point through `gen-gait.ts`'s pinhole camera, with its
landmark noise and visibility; passes follow each other on one clock with the walker out of the
picture between them. `scripts/fixtures/mocap_to_fixture.py` writes the files (its header gives the
method and the usage; it reads the c3d files with ezc3d 1.7.2, MIT License, Copyright (c) 2018
pyomeca, fetching only the named members of the figshare zips).

### Sources and licences

- **Van Criekinge T, Saeys W, Truijen S, Vereeck L, Sloot LH, Hallemans A.** A full-body motion
  capture gait dataset of 138 able-bodied adults across the life span and 50 stroke survivors.
  Sci Data 2023;10:852. figshare collection 6503791: c3d files of the able bodied adults
  (doi 10.6084/m9.figshare.24192480, `138_HealthyPiG.zip`) and of the adults with stroke
  (doi 10.6084/m9.figshare.24192483, `50_StrokePiG.zip`); the stroke workbook
  (doi 10.6084/m9.figshare.24192495) for its paretic labels. The figshare files are released under
  CC0 1.0; the article under CC BY 4.0.
- **Fukuchi CA, Fukuchi RK, Duarte M.** A public dataset of overground and treadmill walking
  kinematics and kinetics in healthy individuals. PeerJ 2018;6:e4640. figshare
  doi 10.6084/m9.figshare.5722711, version 6 (`WBDSc3dWithGaitEvents.zip`, `WBDSinfo.csv`), CC BY
  4.0 (https://creativecommons.org/licenses/by/4.0/). The fixtures `wbds-*` are adapted from it:
  hip joint centres estimated from the pelvis markers, knee and ankle centres from the lateral
  markers and the static widths, short marker gaps filled (a missing pelvis marker from the others
  as a rigid body), a synthetic upper body added, 15 s of each 30 s treadmill trial resampled to
  30 Hz and projected to 2D.

### What each landmark is

- Van Criekinge, from the Plug-in Gait model outputs in the c3d: hips the hip joint centres (LFEP,
  RFEP), knees the knee joint centres (LFEO, RFEO), ankles the ankle joint centres (LTIO, RTIO),
  heels the HEE markers, foot index the TOE markers, shoulders, elbows and wrists the joint centres
  (LHUP, LHUO, LRAO and their right twins). The nose and eyes have no marker and are built from the
  front head markers along the Plug-in Gait head axes.
- Fukuchi, from the markers: hip joint centres by Harrington et al. 2007 (J Biomech 40:595) from the
  ASIS and PSIS markers; knee and ankle joint centres half the static knee or ankle width medial of
  the lateral markers; heels the Heel markers; foot index the midpoint of MT1 and MT5. The trunk,
  arms and face are synthetic (the dataset has no upper body markers), so no test reads a trunk or
  arm metric from these walks. Events: each side's foot on the instrumented treadmill or heel
  strike, and foot off or toe off, the pair of labels that alternates on that side (a few trials lack
  a label or hold spurious events under one).

### Stroke survivors: which leg is paretic

The stroke workbook labels a "P" (paretic) side for each walker; `--paretic` finds it by matching
the workbook's curves to the walker's knees. In 40 of the workbook's 50 walkers the "P" leg is the
one whose knee bends more in swing and whose hip extends further, the opposite of the usual picture
after a stroke (the "P" may name the lesion's side; the article gives lesion location L/R 17/33).
Each stroke fixture therefore keeps both, the workbook's `workbookPside` and the leg whose knee
bends less in the dataset's own angles (`stifferKneeSide`, with `kneeSwingPeakDeg`), and no test
calls either the paretic side without saying which.

### The committed subset

20 able bodied adults across ages (born in the 1920s to the 1990s), each with passes in both walking
directions (`vc-ab-*`); 10 stroke survivors across walking speeds (`vc-st-*`); 10 adults, 5 young
and 5 older, on the treadmill at a slow, a middle and a fast speed (the dataset's T01, T04 and T07,
`wbds-*`). Speeds are the dataset's (m/s, per pass).

| Fixture       | Walker                                        | Speed                  | Source trials (static first)                                                                                                  |
| ------------- | --------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `vc-ab-001`   | male, 158 cm, born in the 1920s               | 1.08, 1.10, 0.98       | `138_HealthyPiG_10.05/SUBJ01/` `SUBJ1 (0).c3d`, `SUBJ1 (1).c3d`, `SUBJ1 (2).c3d`, `SUBJ1 (3).c3d`                             |
| `vc-ab-005`   | female, 145 cm, born in the 1930s             | 0.80, 0.90, 0.72       | `138_HealthyPiG_10.05/SUBJ05/` `SUBJ5 (0).c3d`, `SUBJ5 (1).c3d`, `SUBJ5 (2).c3d`, `SUBJ5 (3).c3d`                             |
| `vc-ab-009`   | male, 171 cm, born in the 1930s               | 1.08, 1.06, 1.15       | `138_HealthyPiG_10.05/SUBJ09/` `SUBJ9 (0).c3d`, `SUBJ9 (1).c3d`, `SUBJ9 (2).c3d`, `SUBJ9 (3).c3d`                             |
| `vc-ab-013`   | female, 154 cm, born in the 1930s             | 1.06, 1.05, 1.04       | `138_HealthyPiG_10.05/SUBJ13/` `SUBJ13 (0).c3d`, `SUBJ13 (1).c3d`, `SUBJ13 (2).c3d`, `SUBJ13 (3).c3d`                         |
| `vc-ab-016`   | male, 175 cm, born in the 1930s               | 1.21, 1.13, 1.18       | `138_HealthyPiG_10.05/SUBJ16/` `SUBJ16 (0).c3d`, `SUBJ16 (2).c3d`, `SUBJ16 (3).c3d`, `SUBJ16 (4).c3d`                         |
| `vc-ab-020`   | female, 142 cm, born in the 1940s             | 0.96, 0.95, 0.99       | `138_HealthyPiG_10.05/SUBJ20/` `SUBJ20 (0).c3d`, `SUBJ20 (1).c3d`, `SUBJ20 (2).c3d`, `SUBJ20 (3).c3d`                         |
| `vc-ab-026`   | female, 160.5 cm, born in the 1940s           | 1.30, 1.31, 1.28       | `138_HealthyPiG_10.05/SUBJ26/` `SUBJ26 (0).c3d`, `SUBJ26 (1).c3d`, `SUBJ26 (2).c3d`, `SUBJ26 (3).c3d`                         |
| `vc-ab-032`   | male, 165.5 cm, born in the 1940s             | 1.09, 1.07, 1.04, 1.08 | `138_HealthyPiG_10.05/SUBJ32/` `SUBJ32 (0).c3d`, `SUBJ32 (1).c3d`, `SUBJ32 (2).c3d`, `SUBJ32 (3).c3d`, `SUBJ32 (4).c3d`       |
| `vc-ab-033`   | male, 183 cm, born in the 1940s               | 1.48, 1.42, 1.42, 1.41 | `138_HealthyPiG_10.05/SUBJ33/` `SUBJ33 (0).c3d`, `SUBJ33 (1).c3d`, `SUBJ33 (2).c3d`, `SUBJ33 (3).c3d`, `SUBJ33 (4).c3d`       |
| `vc-ab-049`   | female, 166 cm, born in the 1950s             | 1.11, 1.12, 1.09       | `138_HealthyPiG_10.05/SUBJ49/` `SUBJ49 (0).c3d`, `SUBJ49 (1).c3d`, `SUBJ49 (2).c3d`, `SUBJ49 (3).c3d`                         |
| `vc-ab-052`   | female, 164 cm, born in the 1950s             | 1.06, 1.05, 0.99       | `138_HealthyPiG_10.05/SUBJ52/` `SUBJ52 (0).c3d`, `SUBJ52 (1).c3d`, `SUBJ52 (2).c3d`, `SUBJ52 (3).c3d`                         |
| `vc-ab-055`   | male, 168.5 cm, born in the 1960s             | 1.05, 1.08, 0.99       | `138_HealthyPiG_10.05/SUBJ55/` `SUBJ55 (0).c3d`, `SUBJ55 (1).c3d`, `SUBJ55 (2).c3d`, `SUBJ55 (3).c3d`                         |
| `vc-ab-068`   | female, 168 cm, born in the 1960s             | 1.63, 1.69, 1.49       | `138_HealthyPiG_10.05/SUBJ68/` `SUBJ68 (0).c3d`, `SUBJ68 (1).c3d`, `SUBJ68 (2).c3d`, `SUBJ68 (3).c3d`                         |
| `vc-ab-076`   | female, 147.5 cm, born in the 1970s           | 1.17, 1.20, 1.19       | `138_HealthyPiG_10.05/SUBJ76/` `SUBJ76 (0).c3d`, `SUBJ76 (1).c3d`, `SUBJ76 (2).c3d`, `SUBJ76 (3).c3d`                         |
| `vc-ab-081`   | female, 175 cm, born in the 1970s             | 1.14, 1.17, 1.14       | `138_HealthyPiG_10.05/SUBJ81/` `SUBJ81 (0).c3d`, `SUBJ81 (1).c3d`, `SUBJ81 (2).c3d`, `SUBJ81 (3).c3d`                         |
| `vc-ab-091`   | female, 170 cm, born in the 1980s             | 1.33, 1.38, 1.35       | `138_HealthyPiG_10.05/SUBJ91/` `SUBJ91 (0).c3d`, `SUBJ91 (1).c3d`, `SUBJ91 (2).c3d`, `SUBJ91 (3).c3d`                         |
| `vc-ab-097`   | male, 191 cm, born in the 1980s               | 1.32, 1.38, 1.37       | `138_HealthyPiG_10.05/SUBJ97/` `SUBJ97 (0).c3d`, `SUBJ97 (1).c3d`, `SUBJ97 (2).c3d`, `SUBJ97 (3).c3d`                         |
| `vc-ab-099`   | male, 178 cm, born in the 1980s               | 1.31, 1.29, 1.31       | `138_HealthyPiG_10.05/SUBJ99/` `SUBJ99 (0).c3d`, `SUBJ99 (1).c3d`, `SUBJ99 (2).c3d`, `SUBJ99 (3).c3d`                         |
| `vc-ab-103`   | female, 169 cm, born in the 1980s             | 1.07, 0.99, 1.00       | `138_HealthyPiG_10.05/SUBJ103/` `SUBJ103 (0).c3d`, `SUBJ103 (1).c3d`, `SUBJ103 (2).c3d`, `SUBJ103 (3).c3d`                    |
| `vc-ab-136`   | female, born in the 1990s                     | 1.37, 1.38, 1.34, 1.32 | `138_HealthyPiG_10.05/SUBJ136/` `SUBJ136 (0).c3d`, `SUBJ136 (2).c3d`, `SUBJ136 (3).c3d`, `SUBJ136 (4).c3d`, `SUBJ136 (5).c3d` |
| `vc-st-003`   | 171 cm, workbook P left, stiffer knee right   | 0.27, 0.25, 0.24       | `50_StrokePiG/TVC03/` `TVC-3 Cal 04.c3d`, `BWA6.c3d`, `BWA7.c3d`, `BWA8.c3d`                                                  |
| `vc-st-004`   | 158.5 cm, workbook P right, stiffer knee left | 0.93, 0.92, 0.88       | `50_StrokePiG/TVC04/` `TVC-4 Cal 03.c3d`, `BWA_6.c3d`, `BWA_7.c3d`, `BWA_8.c3d`                                               |
| `vc-st-006`   | 175.5 cm, workbook P right, stiffer knee left | 0.71, 0.68, 0.62       | `50_StrokePiG/TVC06/` `TVC-6 Cal 03.c3d`, `BWA_2.c3d`, `BWA_5.c3d`, `BWA_6.c3d`                                               |
| `vc-st-011`   | 180 cm, workbook P right, stiffer knee left   | 0.40, 0.49, 0.54       | `50_StrokePiG/TVC11/` `TVC-11 Cal 04.c3d`, `bwa1.c3d`, `bwa2.c3d`, `bwa5.c3d`                                                 |
| `vc-st-015`   | 170 cm, workbook P left, stiffer knee left    | 0.85, 0.89, 0.88       | `50_StrokePiG/TVC15/` `TVC-15 Cal 03.c3d`, `BWA3.c3d`, `BWA4.c3d`, `BWA5.c3d`                                                 |
| `vc-st-020`   | 172 cm, workbook P left, stiffer knee right   | 1.32, 1.39, 1.38       | `50_StrokePiG/TVC20/` `TVC-20 Cal 03.c3d`, `BWA2.c3d`, `BWA5.c3d`, `BWA6.c3d`                                                 |
| `vc-st-032`   | 179 cm, workbook P right, stiffer knee left   | 0.76, 0.83, 0.72       | `50_StrokePiG/TVC32/` `TVC-32 Cal 03.c3d`, `BWA 06.c3d`, `BWA 07.c3d`, `BWA 08.c3d`                                           |
| `vc-st-046`   | 183 cm, workbook P right, stiffer knee left   | 1.14, 1.07, 1.14       | `50_StrokePiG/TVC46/` `TVC-46 Cal 03.c3d`, `BWA05.c3d`, `BWA06.c3d`, `BWA07.c3d`                                              |
| `vc-st-052`   | 165 cm, workbook P right, stiffer knee left   | 1.15, 1.18, 1.17       | `50_StrokePiG/TVC52/` `TVC-52 Cal 05.c3d`, `BWA5.c3d`, `BWA6.c3d`, `BWA7.c3d`                                                 |
| `vc-st-055`   | 173 cm, workbook P right, stiffer knee left   | 0.54, 0.55, 0.55       | `50_StrokePiG/TVC55/` `TVC-55 Cal 02.c3d`, `BWA4.c3d`, `BWA5.c3d`, `BWA6.c3d`                                                 |
| `wbds-01-t01` | male, 172.5 cm, 25 years                      | 0.49                   | `WBDS01static1.c3d`, `WBDS01walkT01.c3d`                                                                                      |
| `wbds-01-t04` | male, 172.5 cm, 25 years                      | 1.03                   | `WBDS01static1.c3d`, `WBDS01walkT04.c3d`                                                                                      |
| `wbds-01-t07` | male, 172.5 cm, 25 years                      | 1.58                   | `WBDS01static1.c3d`, `WBDS01walkT07.c3d`                                                                                      |
| `wbds-02-t01` | female, 166.8 cm, 22 years                    | 0.50                   | `WBDS02static1.c3d`, `WBDS02walkT01.c3d`                                                                                      |
| `wbds-02-t04` | female, 166.8 cm, 22 years                    | 1.06                   | `WBDS02static1.c3d`, `WBDS02walkT04.c3d`                                                                                      |
| `wbds-02-t07` | female, 166.8 cm, 22 years                    | 1.63                   | `WBDS02static1.c3d`, `WBDS02walkT07.c3d`                                                                                      |
| `wbds-07-t01` | female, 157.5 cm, 24 years                    | 0.44                   | `WBDS07static1.c3d`, `WBDS07walkT01.c3d`                                                                                      |
| `wbds-07-t04` | female, 157.5 cm, 24 years                    | 0.94                   | `WBDS07static1.c3d`, `WBDS07walkT04.c3d`                                                                                      |
| `wbds-07-t07` | female, 157.5 cm, 24 years                    | 1.43                   | `WBDS07static1.c3d`, `WBDS07walkT07.c3d`                                                                                      |
| `wbds-11-t01` | male, 192 cm, 32 years                        | 0.53                   | `WBDS11static1.c3d`, `WBDS11walkT01.c3d`                                                                                      |
| `wbds-11-t04` | male, 192 cm, 32 years                        | 1.12                   | `WBDS11static1.c3d`, `WBDS11walkT04.c3d`                                                                                      |
| `wbds-11-t07` | male, 192 cm, 32 years                        | 1.71                   | `WBDS11static1.c3d`, `WBDS11walkT07.c3d`                                                                                      |
| `wbds-16-t01` | male, 172.9 cm, 31 years                      | 0.44                   | `WBDS16static1.c3d`, `WBDS16walkT01.c3d`                                                                                      |
| `wbds-16-t04` | male, 172.9 cm, 31 years                      | 0.94                   | `WBDS16static1.c3d`, `WBDS16walkT04.c3d`                                                                                      |
| `wbds-16-t07` | male, 172.9 cm, 31 years                      | 1.43                   | `WBDS16static1.c3d`, `WBDS16walkT07.c3d`                                                                                      |
| `wbds-25-t01` | male, 168 cm, 59 years                        | 0.47                   | `WBDS25static1.c3d`, `WBDS25walkT01.c3d`                                                                                      |
| `wbds-25-t04` | male, 168 cm, 59 years                        | 0.99                   | `WBDS25static1.c3d`, `WBDS25walkT04.c3d`                                                                                      |
| `wbds-25-t07` | male, 168 cm, 59 years                        | 1.52                   | `WBDS25static1.c3d`, `WBDS25walkT07.c3d`                                                                                      |
| `wbds-30-t01` | female, 157 cm, 58 years                      | 0.43                   | `WBDS30static1.c3d`, `WBDS30walkT01.c3d`                                                                                      |
| `wbds-30-t04` | female, 157 cm, 58 years                      | 0.92                   | `WBDS30static1.c3d`, `WBDS30walkT04.c3d`                                                                                      |
| `wbds-30-t07` | female, 157 cm, 58 years                      | 1.40                   | `WBDS30static1.c3d`, `WBDS30walkT07.c3d`                                                                                      |
| `wbds-33-t01` | male, 172.3 cm, 63 years                      | 0.51                   | `WBDS33static1.c3d`, `WBDS33walkT01.c3d`                                                                                      |
| `wbds-33-t04` | male, 172.3 cm, 63 years                      | 1.08                   | `WBDS33static1.c3d`, `WBDS33walkT04.c3d`                                                                                      |
| `wbds-33-t07` | male, 172.3 cm, 63 years                      | 1.65                   | `WBDS33static1.c3d`, `WBDS33walkT07.c3d`                                                                                      |
| `wbds-35-t01` | male, 167 cm, 68 years                        | 0.52                   | `WBDS35static1.c3d`, `WBDS35walkT01.c3d`                                                                                      |
| `wbds-35-t04` | male, 167 cm, 68 years                        | 1.10                   | `WBDS35static1.c3d`, `WBDS35walkT04.c3d`                                                                                      |
| `wbds-35-t07` | male, 167 cm, 68 years                        | 1.68                   | `WBDS35static1.c3d`, `WBDS35walkT07.c3d`                                                                                      |
| `wbds-41-t01` | female, 149.5 cm, 55 years                    | 0.47                   | `WBDS41static1.c3d`, `WBDS41walkT01.c3d`                                                                                      |
| `wbds-41-t04` | female, 149.5 cm, 55 years                    | 0.99                   | `WBDS41static1.c3d`, `WBDS41walkT04.c3d`                                                                                      |
| `wbds-41-t07` | female, 149.5 cm, 55 years                    | 1.52                   | `WBDS41static1.c3d`, `WBDS41walkT07.c3d`                                                                                      |
