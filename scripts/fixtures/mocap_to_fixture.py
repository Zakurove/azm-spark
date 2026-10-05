#!/usr/bin/env python3
"""
Motion capture gait fixtures for the v7 gait engine (product v7 contract 6.1 and 8.3, stream C,
step C2). Dev only, never shipped, never run by CI.

What it does. Reads named trials of two open motion capture datasets with ezc3d, takes the points
that stand in for the 19 MediaPipe landmarks the gait engine reads (nose, eyes, shoulders, elbows,
wrists, hips, knees, ankles, heels and foot index), samples them at 30 Hz with frame time jitter, and
writes one compact fixture per walker under tests/fixtures/gait/mocap/: the room coordinates of
every frame, the standing calibration from the dataset's static trial, and the dataset's own gait
events as the truth. tests/fixtures/gait/mocap.ts projects these frames through the same pinhole
camera as the synthetic walker (tests/fixtures/gait/gen-gait.ts), for any view the test asks for
(side, front toward, back away, walking pad side and front), with landmark noise and the model's
visibility; the engine never sees a coordinate that the camera could not.

Sources (named per trial in tests/fixtures/gait/README.md and in each fixture's "sourceFiles"):

  Van Criekinge T, Saeys W, Truijen S, Vereeck L, Sloot LH, Hallemans A. A full-body motion capture
  gait dataset of 138 able-bodied adults across the life span and 50 stroke survivors. Sci Data
  2023;10:852. figshare collection 6503791: "c3d files ... of 138 able-bodied adults"
  (10.6084/m9.figshare.24192480, file 138_HealthyPiG.zip) and "... of 50 adults with stroke"
  (10.6084/m9.figshare.24192483, file 50_StrokePiG.zip); "Post-processed excel-files ... of 50 adults
  with stroke" (10.6084/m9.figshare.24192495) for its paretic ("P") side labels. Files CC0 1.0; the article
  CC BY 4.0. Barefoot overground walking at a preferred speed on a 12 m walkway, Plug-in Gait full
  body, 100 Hz, events (Foot Strike, Foot Off) from Vicon Nexus checked by the authors.

  Fukuchi CA, Fukuchi RK, Duarte M. A public dataset of overground and treadmill walking kinematics
  and kinetics in healthy individuals. PeerJ 2018;6:e4640. figshare 10.6084/m9.figshare.5722711
  (v6), files WBDSc3dWithGaitEvents.zip and WBDSinfo.csv, CC BY 4.0. Treadmill walking at eight
  speeds, 150 Hz, pelvis and lower limb markers only, events from the dataset's Visual3D pipeline:
  each side's foot on the instrumented treadmill (LON RON) or heel strike (LHS RHS) and its foot off
  (LOFF ROFF) or toe off (LTO RTO), the pair that alternates on that side (a few trials lack a label
  or hold spurious events under one).

Which point stands for which landmark:

  Van Criekinge (Plug-in Gait model outputs in the c3d): hips 23 and 24 are the hip joint centres
  LFEP and RFEP (their midpoint is PELO); knees 25 and 26 the knee joint centres LFEO and RFEO;
  ankles 27 and 28 the ankle joint centres LTIO and RTIO; heels 29 and 30 the HEE markers; foot index
  31 and 32 the TOE markers (second metatarsal head); shoulders 11 and 12 the shoulder joint centres
  LHUP and RHUP; elbows 13 and 14 the elbow joint centres LHUO and RHUO; wrists 15 and 16 the wrist
  joint centres LRAO and RRAO. The face has no marker: the nose 0 is the midpoint of the front head
  markers LFHD and RFHD moved 30 mm forward and 70 mm down along the Plug-in Gait head axes (HEDO to
  HEDA forward, HEDO to HEDP up), the eyes 2 and 5 sit 30 mm up and 30 mm to each side of it.

  Fukuchi (markers only): the hip joint centres by Harrington et al. 2007 (J Biomech 40:595, the
  regression on the pelvis width PW between the ASIS markers and the depth PD from the ASIS to the
  PSIS midpoints: 0.24 PD + 9.9 mm behind, 0.30 PW + 10.9 mm below and 0.33 PW + 7.3 mm to the side
  of the ASIS midpoint); the knee and ankle joint centres half the knee or ankle width medial of the
  lateral markers (Knee, Ankle), the widths from the static trial's medial markers, along the
  pelvis's left to right axis; heels the Heel markers; foot index the midpoint of MT1 and MT5. The
  dataset has no upper body markers, so the trunk, arms and head are synthetic: an upright trunk on
  the hip midpoint with the synthetic walker's proportions (gen-gait bodyOf: trunk 0.49, shoulder
  half width 0.175, upper arm 0.3, forearm 0.25, nose 0.16 up and 0.094 forward, each times the
  height over 1.70 m) and arms that swing 20 degrees each way opposite their own leg. The fixture
  lists these landmarks in "synthetic", so no test reads a trunk or arm metric from them.

Coordinates: millimetres in a room frame with x along the walkway (the treadmill belt), y up and z
across, right handed (x cross y = z, so z is the right of a walker facing +x). Overground passes keep
the lab's x; the treadmill keeps its lab frame, where the pelvis stays near one place and the belt
carries the feet back.

Sampling: frame k of a pass is at k/30 s plus a uniform jitter of up to 4 ms (seeded per fixture),
with each point linearly interpolated between the dataset's samples; a point missing in either
neighbour is missing (null). Events keep the dataset's times on the same clock (milliseconds from the
pass's first sample). The static trial gives the standing calibration: its own samples at 30 Hz,
repeated to 3 s.

Output (one JSON file per fixture, written compactly; prettier ignores tests/fixtures/**/*.json):

  { "format": "azm-gait-mocap-1", "id", "dataset", "licence", "citation", "sourceFiles": [...],
    "subject": { "group", "sex", "heightCm", "legLengthCm", "ageYears" | "birthDecade",
                 stroke only: "workbookPside", "kneeSwingPeakDeg", "stifferKneeSide" },
    "mode": "overground" | "treadmill", "fps": 30, "jitterMs": 4, "seed",
    "landmarks": [0, 2, 5, 11, ...], "synthetic": [...],
    "encoding": "delta",
    "standing": { "t": [ms], "p": [frame, ...] },
    "passes": [ { "file", "dir": 1 | -1, "speedMps", "t": [ms], "p": [frame, ...],
                  "events": [["left" | "right", "ic" | "to", ms], ...] } ] }

  A frame is a flat list of 57 integers, x, y and z of each listed landmark in order: the first
  frame of the standing or of a pass in full, every later one as the change from the landmark's last
  value (null, three times, where the landmark is missing). tests/fixtures/gait/mocap.ts reads it.

Usage, from the repository root (Python 3.10 or later with numpy and ezc3d 1.7.2, MIT License,
Copyright (c) 2018 pyomeca; openpyxl only for --paretic):

    python3 -m venv .venv-fixtures && .venv-fixtures/bin/pip install numpy ezc3d==1.7.2 openpyxl
    .venv-fixtures/bin/python scripts/fixtures/mocap_to_fixture.py --cache /tmp/azm-mocap

The cache holds the c3d files; a file that is not there is read from the dataset's zip on figshare
with HTTP range requests (only that member is transferred, about 1 to 3 MB each) and kept in the
cache. --only <id> writes one fixture. The workbook's "P" side of each stroke survivor is in SUBSET
below; --paretic re-derives it from the dataset's own stroke workbook (the walker's left and right
knee curves against the workbook's "Pside" and "Nside" curves, sheets in folder order) and prints
it. The workbook's "P" leg is the one whose knee bends more in swing in 40 of its 50 walkers (the
opposite of the usual picture after a stroke), so each stroke fixture also names the leg whose knee
bends less in the dataset's own angles (stifferKneeSide) and the tests never take either for the
paretic side without saying which.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import random
import re
import sys
import tempfile
import urllib.request
import zipfile

import numpy as np

try:
    import ezc3d
except ImportError:  # pragma: no cover - dev tool
    sys.exit("mocap_to_fixture.py needs ezc3d (pip install ezc3d==1.7.2)")

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(ROOT, "tests", "fixtures", "gait", "mocap")

FPS = 30
JITTER_MS = 4
STANDING_SEC = 3.0
LANDMARKS = [0, 2, 5, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]

VC_CITATION = (
    "Van Criekinge T et al. A full-body motion capture gait dataset of 138 able-bodied adults "
    "across the life span and 50 stroke survivors. Sci Data 2023;10:852"
)
VC_LICENCE = "CC0 1.0 (figshare files); article CC BY 4.0"
WBDS_CITATION = (
    "Fukuchi CA, Fukuchi RK, Duarte M. A public dataset of overground and treadmill walking "
    "kinematics and kinetics in healthy individuals. PeerJ 2018;6:e4640"
)
WBDS_LICENCE = "CC BY 4.0"

ZIPS = {
    "vc_ab": "https://ndownloader.figshare.com/files/42450060",  # 138_HealthyPiG.zip
    "vc_st": "https://ndownloader.figshare.com/files/42450069",  # 50_StrokePiG.zip
    "wbds": "https://ndownloader.figshare.com/files/12403928",  # WBDSc3dWithGaitEvents.zip
}
WBDS_INFO = "https://ndownloader.figshare.com/files/68504641"  # WBDSinfo.csv
VC_STROKE_XLSX = "https://ndownloader.figshare.com/files/42450084"

# ---------------------------------------------------------------------------------------------
# The committed subset (contract 8.3): 20 able bodied adults across ages, each with passes in both
# walking directions; 10 stroke survivors across walking speeds; 10 adults (5 young, 5 older) on the
# treadmill at a slow, a middle and a fast speed (T01, T04, T07 of the dataset's eight).
# ---------------------------------------------------------------------------------------------

VC_AB = "138_HealthyPiG_10.05"
VC_ST = "50_StrokePiG"


def _vc_ab(n: int, walks: list[int], static: int = 0) -> dict:
    sub = f"SUBJ{n:02d}"
    return {
        "id": f"vc-ab-{n:03d}",
        "source": "vc_ab",
        "subject": sub,
        "static": f"{VC_AB}/{sub}/SUBJ{n} ({static}).c3d",
        "trials": [f"{VC_AB}/{sub}/SUBJ{n} ({w}).c3d" for w in walks],
    }


def _vc_st(n: int, paretic: str) -> dict:
    # The static (Cal) and walking (BWA) trial names differ per folder: filled from the zip listing.
    return {"id": f"vc-st-{n:03d}", "source": "vc_st", "subject": f"TVC{n:02d}", "static": None, "trials": [], "paretic": paretic}


def _wbds(n: int, t: int) -> dict:
    return {
        "id": f"wbds-{n:02d}-t{t:02d}",
        "source": "wbds",
        "subject": n,
        "static": f"WBDS{n:02d}static1.c3d",
        "trials": [f"WBDS{n:02d}walkT{t:02d}.c3d"],
        # The middle 15 s of the 30 s treadmill trial.
        "window": [7.5, 22.5],
    }


SUBSET: list[dict] = (
    [
        _vc_ab(n, walks)
        for n, walks in [
            (1, [1, 2, 3]),
            (5, [1, 2, 3]),
            (9, [1, 2, 3]),
            (13, [1, 2, 3]),
            (16, [2, 3, 4]),
            (20, [1, 2, 3]),
            (26, [1, 2, 3]),
            (32, [1, 2, 3, 4]),
            (33, [1, 2, 3, 4]),
            (49, [1, 2, 3]),
            (52, [1, 2, 3]),
            (55, [1, 2, 3]),
            (68, [1, 2, 3]),
            (76, [1, 2, 3]),
            (81, [1, 2, 3]),
            (91, [1, 2, 3]),
            (97, [1, 2, 3]),
            (99, [1, 2, 3]),
            (103, [1, 2, 3]),
            (136, [2, 3, 4, 5]),
        ]
    ]
    + [
        _vc_st(n, paretic)
        for n, paretic in [
            (3, "left"),
            (4, "right"),
            (6, "right"),
            (11, "right"),
            (15, "left"),
            (20, "left"),
            (32, "right"),
            (46, "right"),
            (52, "right"),
            (55, "right"),
        ]
    ]
    + [_wbds(n, t) for n in [1, 2, 7, 11, 16, 25, 30, 33, 35, 41] for t in [1, 4, 7]]
)

# Stroke walks are long at slow speeds: at most this much walking per fixture (whole passes first).
MAX_WALK_SEC = 30.0

# ---------------------------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------------------------


class HttpFile(io.RawIOBase):
    """A read only, seekable file over HTTP range requests (figshare redirects to S3)."""

    def __init__(self, url: str, block: int = 1 << 20):
        self.url = url
        self.pos = 0
        self.block = block
        self.cache: dict[int, bytes] = {}
        req = urllib.request.Request(url, headers={"Range": "bytes=0-0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            self.size = int(r.headers["Content-Range"].split("/")[-1])

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, off: int, whence: int = 0) -> int:
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def _block(self, i: int) -> bytes:
        if i not in self.cache:
            a = i * self.block
            b = min(self.size, a + self.block) - 1
            req = urllib.request.Request(self.url, headers={"Range": f"bytes={a}-{b}"})
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            if len(self.cache) > 64:
                self.cache.clear()
            self.cache[i] = data
        return self.cache[i]

    def read(self, n: int = -1) -> bytes:
        if n is None or n < 0:
            n = self.size - self.pos
        n = max(0, min(n, self.size - self.pos))
        out = bytearray()
        while n > 0:
            i = self.pos // self.block
            blk = self._block(i)
            o = self.pos - i * self.block
            take = blk[o : o + n]
            out += take
            self.pos += len(take)
            n -= len(take)
        return bytes(out)

    def readinto(self, b) -> int:  # type: ignore[override]
        d = self.read(len(b))
        b[: len(d)] = d
        return len(d)


_zips: dict[str, zipfile.ZipFile] = {}
# --zip SOURCE=PATH: read a source from a local copy of its zip instead of figshare.
LOCAL_ZIPS: dict[str, str] = {}


def _zip(source: str) -> zipfile.ZipFile:
    if source not in _zips:
        local = LOCAL_ZIPS.get(source)
        _zips[source] = zipfile.ZipFile(local if local else HttpFile(ZIPS[source]))
    return _zips[source]


def cached(cache: str, source: str, member: str) -> str:
    """The local path of a zip member, fetched by range requests when missing."""
    path = os.path.join(cache, source, member.replace("/", "__"))
    if os.path.exists(path):
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with _zip(source).open(member) as src:
        data = src.read()
    with open(path + ".part", "wb") as dst:
        dst.write(data)
    os.replace(path + ".part", path)
    return path


def members(cache: str, source: str) -> list[str]:
    """Every c3d member of a source zip (for subjects whose trial names are not listed above)."""
    listing = os.path.join(cache, source, "_members.json")
    if os.path.exists(listing):
        return json.load(open(listing))
    names = [i.filename for i in _zip(source).infolist() if i.filename.lower().endswith(".c3d")]
    os.makedirs(os.path.dirname(listing), exist_ok=True)
    json.dump(names, open(listing, "w"))
    return names


class Trial:
    """One c3d file: points by label (mm, lab frame), the rate, the first frame's time, events."""

    def __init__(self, path: str):
        c = ezc3d.c3d(path)
        p = c["parameters"]
        labels = [l.split(":")[-1].strip() for l in p["POINT"]["LABELS"]["value"]]
        pts = np.array(c["data"]["points"][:3], dtype=float)
        # A point at the origin is a gap in Vicon's c3d.
        gap = np.all(pts == 0, axis=0) | ~np.all(np.isfinite(pts), axis=0)
        pts[:, gap] = np.nan
        self.points = {l: pts[:, i, :] for i, l in enumerate(labels)}
        self.rate = float(p["POINT"]["RATE"]["value"][0])
        self.first = int(c["header"]["points"]["first_frame"])
        self.n = pts.shape[2]
        self.t0 = self.first / self.rate
        self.events: list[tuple[str, str, float]] = []
        ev = p.get("EVENT", {})
        used = int(ev.get("USED", {}).get("value", [0])[0]) if ev else 0
        if used:
            labs = [l.strip() for l in ev["LABELS"]["value"]]
            times = np.array(ev["TIMES"]["value"])[1]
            ctxs = ev["CONTEXTS"]["value"] if "CONTEXTS" in ev else [""] * len(labs)
            if any(l in ("LON", "RON", "LOFF", "ROFF") for l in labs):
                self.events = _treadmill_events(labs, times)
            else:
                for lab, ctx, tm in zip(labs, ctxs, times):
                    kind = _event_kind(lab)
                    side = _event_side(lab, ctx)
                    if kind and side:
                        self.events.append((side, kind, float(tm)))
        self.events.sort(key=lambda e: e[2])
        proc = p.get("PROCESSING", {})
        self.height = float(proc["Height"]["value"][0]) if "Height" in proc else None
        self.leg = float(proc["LLegLength"]["value"][0]) if "LLegLength" in proc else None
        subj = p.get("SUBJECTS", {}).get("NAMES", {}).get("value", [""])
        self.subject_name = subj[0] if subj else ""

    def has(self, *labels: str) -> bool:
        return all(l in self.points for l in labels)

    def at(self, label: str, t: float) -> np.ndarray:
        """The point at time t (s, the trial's clock): linear between samples, NaN in a gap."""
        x = self.points[label]
        f = (t - self.t0) * self.rate
        i = int(np.floor(f))
        if i < 0 or i + 1 >= self.n:
            if 0 <= f <= self.n - 1:
                return x[:, int(round(f))]
            return np.full(3, np.nan)
        w = f - i
        return x[:, i] * (1 - w) + x[:, i + 1] * w


def _alternation_breaks(ics: list[float], tos: list[float]) -> int:
    """How often a side's contacts and toe offs fail to alternate (two of a kind in a row)."""
    seq = sorted([(t, 0) for t in ics] + [(t, 1) for t in tos])
    return sum(1 for a, b in zip(seq, seq[1:]) if a[1] == b[1])


def _treadmill_events(labs: list[str], times: np.ndarray) -> list[tuple[str, str, float]]:
    """Fukuchi's treadmill events: each side's contacts from the force plate (ON) or the heel strike
    (HS) label and its toe offs from OFF or TO, the pair that alternates on that side with the fewest
    breaks (the force plate labels first on a tie); a label missing on a side is never chosen."""
    out: list[tuple[str, str, float]] = []
    for side, p in (("left", "L"), ("right", "R")):
        sets = []
        for on, off in ((p + "ON", p + "OFF"), (p + "ON", p + "TO"), (p + "HS", p + "OFF"), (p + "HS", p + "TO")):
            ics = sorted(float(t) for l, t in zip(labs, times) if l == on)
            tos = sorted(float(t) for l, t in zip(labs, times) if l == off)
            if len(ics) >= 2 and len(tos) >= 2:
                sets.append((_alternation_breaks(ics, tos), len(sets), ics, tos))
        if not sets:
            continue
        _, _, ics, tos = min(sets)
        out += [(side, "ic", t) for t in ics] + [(side, "to", t) for t in tos]
    return out


def _event_kind(label: str) -> str | None:
    l = label.strip().lower()
    if l in ("foot strike", "lhs", "rhs"):
        return "ic"
    if l in ("foot off", "lto", "rto"):
        return "to"
    return None


def _event_side(label: str, ctx: str) -> str | None:
    c = (ctx or "").strip().lower()
    if c in ("left", "right"):
        return c
    l = label.strip().upper()
    if l in ("LHS", "LTO"):
        return "left"
    if l in ("RHS", "RTO"):
        return "right"
    return None


# ---------------------------------------------------------------------------------------------
# Landmark points
# ---------------------------------------------------------------------------------------------


def unit(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else np.full(3, np.nan)


def vc_points(tr: Trial, t: float) -> dict[int, np.ndarray]:
    """The 19 landmark points of a Van Criekinge trial at time t (lab frame, mm)."""
    g = lambda l: tr.at(l, t)  # noqa: E731
    out = {
        23: g("LFEP"),
        24: g("RFEP"),
        25: g("LFEO"),
        26: g("RFEO"),
        27: g("LTIO"),
        28: g("RTIO"),
        29: g("LHEE"),
        30: g("RHEE"),
        31: g("LTOE"),
        32: g("RTOE"),
        11: g("LHUP"),
        12: g("RHUP"),
        13: g("LHUO"),
        14: g("RHUO"),
        15: g("LRAO"),
        16: g("RRAO"),
    }
    fwd = unit(g("HEDA") - g("HEDO"))
    up = unit(g("HEDP") - g("HEDO"))
    left = unit(np.cross(up, fwd)) if np.all(np.isfinite(fwd + up)) else np.full(3, np.nan)
    # Vicon's frame is right handed with z up, so up x forward points to the person's left.
    nose = (g("LFHD") + g("RFHD")) / 2 + 30 * fwd - 70 * up
    out[0] = nose
    out[2] = nose + 30 * up + 30 * left
    out[5] = nose + 30 * up - 30 * left
    return out


def harrington_hjc(lasi, rasi, lpsi, rpsi):
    """Harrington et al. 2007 hip joint centres (mm) from the ASIS and PSIS markers."""
    mid_asis = (lasi + rasi) / 2
    mid_psis = (lpsi + rpsi) / 2
    pw = np.linalg.norm(lasi - rasi)
    pd = np.linalg.norm(mid_asis - mid_psis)
    right = unit(rasi - lasi)
    back = mid_psis - mid_asis
    back = unit(back - np.dot(back, right) * right)
    up = unit(np.cross(back, right))  # back x right = up in a right handed frame
    def at(sign: float) -> np.ndarray:
        return mid_asis + (0.24 * pd + 9.9) * back - (0.30 * pw + 10.9) * up + sign * (0.33 * pw + 7.3) * right
    return at(-1.0), at(1.0)


PELVIS = ["L.ASIS", "R.ASIS", "L.PSIS", "R.PSIS", "L.Iliac.Crest", "R.Iliac.Crest"]
MAX_GAP_SEC = 0.1


def fill_linear(x: np.ndarray, rate: float) -> None:
    """Fills each gap of a marker (3 x n) up to MAX_GAP_SEC by a straight line, in place."""
    bad = ~np.all(np.isfinite(x), axis=0)
    if not bad.any() or bad.all():
        return
    n = x.shape[1]
    k = 0
    while k < n:
        if not bad[k]:
            k += 1
            continue
        a = k
        while k < n and bad[k]:
            k += 1
        if a == 0 or k == n or (k - a) / rate > MAX_GAP_SEC:
            continue
        for j in range(3):
            x[j, a:k] = np.interp(np.arange(a, k), [a - 1, k], [x[j, a - 1], x[j, k]])


def kabsch(src: np.ndarray, dst: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The rotation and translation that best map the points src (k x 3) onto dst (least squares)."""
    cs, cd = src.mean(axis=0), dst.mean(axis=0)
    h = (src - cs).T @ (dst - cd)
    u, _, vt = np.linalg.svd(h)
    d = np.sign(np.linalg.det(vt.T @ u.T))
    r = vt.T @ np.diag([1.0, 1.0, d]) @ u.T
    return r, cd - r @ cs


class Wbds:
    """Joint centres of a Fukuchi trial from its markers and the static trial's widths."""

    def __init__(self, static: Trial):
        mid = lambda l: np.nanmedian(static.points[l], axis=1)  # noqa: E731
        self.knee_half = {}
        self.ankle_half = {}
        for s, p in (("left", "L."), ("right", "R.")):
            self.knee_half[s] = np.linalg.norm(mid(p + "Knee") - mid(p + "Knee.Medial")) / 2
            self.ankle_half[s] = np.linalg.norm(mid(p + "Ankle") - mid(p + "Ankle.Medial")) / 2
        self.pelvis = [l for l in PELVIS if l in static.points]
        self.pelvis_ref = np.array([mid(l) for l in self.pelvis])

    def fill(self, tr: Trial) -> None:
        """Short gaps by a straight line; a pelvis marker still missing from the other pelvis markers
        as a rigid body (the static trial's cluster fitted to the markers seen, least squares)."""
        for x in tr.points.values():
            fill_linear(x, tr.rate)
        names = [l for l in self.pelvis if l in tr.points]
        ref = np.array([self.pelvis_ref[self.pelvis.index(l)] for l in names])
        cl = np.stack([tr.points[l] for l in names])  # markers x 3 x n
        for k in range(tr.n):
            seen = np.all(np.isfinite(cl[:, :, k]), axis=1)
            if seen.all() or seen.sum() < 3:
                continue
            r, t = kabsch(ref[seen], cl[seen, :, k])
            for i in np.where(~seen)[0]:
                tr.points[names[i]][:, k] = r @ ref[i] + t

    def points(self, tr: Trial, t: float) -> dict[int, np.ndarray] | None:
        g = lambda l: tr.at(l, t)  # noqa: E731
        lasi, rasi, lpsi, rpsi = g("L.ASIS"), g("R.ASIS"), g("L.PSIS"), g("R.PSIS")
        if not np.all(np.isfinite(np.concatenate([lasi, rasi, lpsi, rpsi]))):
            return None
        lh, rh = harrington_hjc(lasi, rasi, lpsi, rpsi)
        right = unit(rasi - lasi)
        out = {23: lh, 24: rh}
        for s, p, sign, ids in (("left", "L.", 1.0, (25, 27, 29, 31)), ("right", "R.", -1.0, (26, 28, 30, 32))):
            # Medial is toward the other side: +right for the left leg, -right for the right leg.
            out[ids[0]] = g(p + "Knee") + sign * self.knee_half[s] * right
            out[ids[1]] = g(p + "Ankle") + sign * self.ankle_half[s] * right
            out[ids[2]] = g(p + "Heel")
            out[ids[3]] = (g(p + "MT1") + g(p + "MT5")) / 2
        return out

    def static_points(self, tr: Trial, t: float) -> dict[int, np.ndarray] | None:
        g = lambda l: tr.at(l, t)  # noqa: E731
        lasi, rasi, lpsi, rpsi = g("L.ASIS"), g("R.ASIS"), g("L.PSIS"), g("R.PSIS")
        lh, rh = harrington_hjc(lasi, rasi, lpsi, rpsi)
        out = {23: lh, 24: rh}
        for p, ids in (("L.", (25, 27, 29, 31)), ("R.", (26, 28, 30, 32))):
            out[ids[0]] = (g(p + "Knee") + g(p + "Knee.Medial")) / 2
            out[ids[1]] = (g(p + "Ankle") + g(p + "Ankle.Medial")) / 2
            out[ids[2]] = g(p + "Heel")
            out[ids[3]] = (g(p + "MT1") + g(p + "MT5")) / 2
        return out


def add_upper_body(pt: dict[int, np.ndarray], height_mm: float, up: np.ndarray, phase: dict[str, float] | None):
    """The synthetic trunk, arms and head of a walker without upper body markers (gen-gait bodyOf)."""
    s = height_mm / 1700.0
    lh, rh = pt[23], pt[24]
    pelvis = (lh + rh) / 2
    right = rh - lh
    right = unit(right - np.dot(right, up) * up)
    fwd = unit(np.cross(up, right))  # up x right = forward (right handed)
    mid_sh = pelvis + 490 * s * up
    pt[11] = mid_sh - 175 * s * right
    pt[12] = mid_sh + 175 * s * right
    for side, sh, el, wr, sgn in (("left", 11, 13, 15, -1.0), ("right", 12, 14, 16, 1.0)):
        swing = 0.0 if phase is None else -20.0 * np.cos(2 * np.pi * phase[side])
        a = np.radians(swing)
        arm = -np.cos(a) * up + np.sin(a) * fwd
        a2 = np.radians(swing + 15.0)
        fore = -np.cos(a2) * up + np.sin(a2) * fwd
        pt[el] = pt[sh] + 300 * s * arm
        pt[wr] = pt[el] + 250 * s * fore
    nose = mid_sh + 160 * s * up + 94 * s * fwd
    pt[0] = nose
    pt[2] = nose + 30 * s * up - 30 * s * right
    pt[5] = nose + 30 * s * up + 30 * s * right


# ---------------------------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------------------------


def swing_knee_peaks(trials: list[Trial]) -> dict[str, float]:
    """Each leg's median knee flexion peak in swing (toe off to the next contact), from the Plug-in
    Gait knee angles the c3d holds."""
    out = {}
    for side, p in (("left", "L"), ("right", "R")):
        peaks = []
        for tr in trials:
            k = tr.points.get(p + "KneeAngles")
            if k is None:
                continue
            ics = [e[2] for e in tr.events if e[0] == side and e[1] == "ic"]
            for to in (e[2] for e in tr.events if e[0] == side and e[1] == "to"):
                nxt = [t for t in ics if t > to]
                if not nxt:
                    continue
                a, b = int(round((to - tr.t0) * tr.rate)), int(round((nxt[0] - tr.t0) * tr.rate))
                if a >= 0 and b < tr.n and np.isfinite(k[0, a : b + 1]).any():
                    peaks.append(float(np.nanmax(k[0, a : b + 1])))
        out[side] = float(np.median(peaks))
    return out


def to_room(v: np.ndarray, source: str) -> np.ndarray:
    """Lab to room: x along the walkway, y up, z across (right handed)."""
    if source.startswith("vc"):
        # Vicon: x along the walkway, y across, z up; (x, z, -y) keeps the frame right handed.
        return np.array([v[0], v[2], -v[1]])
    # Fukuchi: x along the belt, y up, z across.
    return np.array([v[0], v[1], v[2]])


def row(pt: dict[int, np.ndarray] | None, source: str, origin: np.ndarray) -> list:
    out: list = []
    for lm in LANDMARKS:
        v = None if pt is None else pt.get(lm)
        if v is None or not np.all(np.isfinite(v)):
            out.append(None)
            continue
        r = to_room(v, source) - origin
        out.append([int(round(r[0])), int(round(r[1])), int(round(r[2]))])
    return out


def frame_times(duration_s: float, rng: random.Random) -> list[float]:
    """30 Hz frame times (s from the start) with a uniform jitter, strictly increasing, inside the span."""
    out = []
    k = 0
    while True:
        base = k / FPS
        if base > duration_s:
            break
        t = base + rng.uniform(-JITTER_MS, JITTER_MS) / 1000.0
        t = min(max(t, 0.0), duration_s)
        if not out or t > out[-1] + 1e-4:
            out.append(t)
        k += 1
    return out


def leg_phase(events: list[tuple[str, str, float]], t: float) -> dict[str, float] | None:
    """Each leg's share of its stride at time t, from its two surrounding initial contacts."""
    out = {}
    for side in ("left", "right"):
        ics = [e[2] for e in events if e[0] == side and e[1] == "ic"]
        prev = [x for x in ics if x <= t]
        nxt = [x for x in ics if x > t]
        if prev and nxt:
            out[side] = (t - prev[-1]) / (nxt[0] - prev[-1])
        elif len(ics) >= 2:
            stride = float(np.median(np.diff(ics)))
            ref = prev[-1] if prev else nxt[0]
            out[side] = ((t - ref) / stride) % 1.0
        else:
            return None
    return out


def build(entry: dict, cache: str, info: dict) -> dict:
    source = entry["source"]
    rng = random.Random(entry["id"])
    vc = source.startswith("vc")
    static = Trial(cached(cache, source, entry["static"]))
    trials = [Trial(cached(cache, source, m)) for m in entry["trials"]]
    height = next((t.height for t in [*trials, static] if t.height), None)
    leg = next((t.leg for t in [*trials, static] if t.leg), None)
    subject: dict = {"group": "stroke" if source == "vc_st" else "able_bodied"}
    if vc:
        name = next((t.subject_name for t in trials if t.subject_name), "")
        births = re.findall(r"(19\d\d)\d{4}", name)
        letters = re.sub(r"[^A-Za-z]", "", name.split("_")[-1]) if births else ""
        sex = {"m": "male", "v": "female", "f": "female"}.get(letters[-1:].lower()) if letters else None
        subject.update({"sex": sex, "heightCm": round(height / 10, 1) if height else None})
        subject["legLengthCm"] = round(leg / 10, 1) if leg else None
        if births:
            subject["birthDecade"] = f"{births[-1][:3]}0s"
        if source == "vc_st":
            # The workbook's "P" (paretic) side, and the leg whose knee bends less in swing in the
            # dataset's own Plug-in Gait angles: in 40 of the workbook's 50 walkers the "P" leg is the
            # one that bends more, so the two can differ (README).
            subject["workbookPside"] = entry["paretic"]
            peaks = swing_knee_peaks(trials)
            subject["kneeSwingPeakDeg"] = {k: round(v, 1) for k, v in peaks.items()}
            subject["stifferKneeSide"] = min(peaks, key=lambda k: peaks[k])
    else:
        meta = info[entry["subject"]]
        height = float(meta["Height"]) * 10
        subject.update(
            {
                "sex": "male" if meta["Gender"] == "M" else "female",
                "heightCm": float(meta["Height"]),
                "legLengthCm": round(float(meta["LegLength"]) * 100, 1),
                "ageYears": int(meta["Age"]),
                "ageGroup": meta["AgeGroup"].lower(),
            }
        )
    wb = None if vc else Wbds(static)
    if wb:
        for tr in trials:
            wb.fill(tr)
    up_room = np.array([0.0, 0.0, 1.0]) if vc else np.array([0.0, 1.0, 0.0])

    def points_at(tr: Trial, t: float, events) -> dict[int, np.ndarray] | None:
        if vc:
            return vc_points(tr, t)
        pt = wb.points(tr, t)
        if pt is None:
            return None
        add_upper_body(pt, height, up_room, leg_phase(events, t))
        return pt

    # The origin: the mean hip midpoint over every pass (overground), so passes stay on one line in
    # the room; the treadmill's mean hip midpoint.
    hips = []
    for tr in trials:
        for k in range(0, tr.n, 10):
            t = tr.t0 + k / tr.rate
            a, b = tr.at("LFEP" if vc else "L.ASIS", t), tr.at("RFEP" if vc else "R.ASIS", t)
            if np.all(np.isfinite(a + b)):
                hips.append(to_room((a + b) / 2, source))
    origin = np.mean(hips, axis=0)
    origin[1] = 0.0  # keep heights above the floor

    passes = []
    walked = 0.0
    for tr, member in zip(trials, entry["trials"]):
        lo, hi = tr.t0, tr.t0 + (tr.n - 1) / tr.rate
        if "window" in entry:
            lo, hi = tr.t0 + entry["window"][0], min(hi, tr.t0 + entry["window"][1])
        # A pass is the span where every leg point exists (the walker inside the capture volume).
        legs = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32]
        valid = []
        for k in range(tr.n):
            t = tr.t0 + k / tr.rate
            if t < lo - 1e-9 or t > hi + 1e-9:
                continue
            pt = points_at(tr, t, tr.events)
            ok = pt is not None and all(np.all(np.isfinite(pt[i])) for i in legs)
            valid.append((t, ok))
        runs, start = [], None
        for t, ok in valid + [(None, False)]:
            if ok and start is None:
                start = t
            if not ok and start is not None:
                runs.append((start, prev_t))
                start = None
            prev_t = t
        if not runs:
            continue
        a, b = max(runs, key=lambda r: r[1] - r[0])
        if walked + (b - a) > MAX_WALK_SEC:
            if passes:
                break
            b = a + MAX_WALK_SEC
        walked += b - a
        times = frame_times(b - a, rng)
        rows = []
        for tt in times:
            rows.append(row(points_at(tr, a + tt, tr.events), source, origin))
        evs = [[s, kind, int(round((te - a) * 1000))] for s, kind, te in tr.events if a - 1e-6 <= te <= b + 1e-6]
        # Walking direction along the room's x, from the hips' travel; the treadmill faces the toes.
        lp, rp = ("LFEP", "RFEP") if vc else ("L.ASIS", "R.ASIS")
        x0 = to_room((tr.at(lp, a) + tr.at(rp, a)) / 2, source)[0]
        x1 = to_room((tr.at(lp, b) + tr.at(rp, b)) / 2, source)[0]
        if vc:
            d = 1 if x1 > x0 else -1
            speed = abs(x1 - x0) / 1000 / (b - a)
        else:
            heel = np.nanmean([to_room(tr.at("L.Heel", a + tt), source)[0] for tt in times[::5]])
            toe = np.nanmean([to_room((tr.at("L.MT1", a + tt) + tr.at("L.MT5", a + tt)) / 2, source)[0] for tt in times[::5]])
            d = 1 if toe > heel else -1
            speed = float(info[entry["subject"]]["speed"][member])
        passes.append(
            {
                "file": member,
                "dir": d,
                "speedMps": round(speed, 3),
                "t": [int(round(tt * 1000)) for tt in times],
                "p": rows,
                "events": evs,
            }
        )

    # Standing: the static trial at 30 Hz, repeated to 3 s.
    st_rows, st_t = [], []
    span = (static.n - 1) / static.rate
    k = 0
    while k / FPS <= STANDING_SEC:
        tt = (k / FPS) % max(span, 1e-3)
        if vc:
            pt = vc_points(static, static.t0 + tt)
        else:
            pt = wb.static_points(static, static.t0 + tt)
            add_upper_body(pt, height, up_room, None)
        st_rows.append(row(pt, source, origin))
        st_t.append(int(round(k * 1000 / FPS + rng.uniform(-JITTER_MS, JITTER_MS))))
        k += 1

    return {
        "format": "azm-gait-mocap-1",
        "id": entry["id"],
        "dataset": "van_criekinge_2023" if vc else "fukuchi_2018",
        "licence": VC_LICENCE if vc else WBDS_LICENCE,
        "citation": VC_CITATION if vc else WBDS_CITATION,
        "sourceFiles": [entry["static"], *[p["file"] for p in passes]],
        "subject": subject,
        "mode": "overground" if vc else "treadmill",
        "fps": FPS,
        "jitterMs": JITTER_MS,
        "seed": entry["id"],
        "landmarks": LANDMARKS,
        "synthetic": [0, 2, 5] if vc else [0, 2, 5, 11, 12, 13, 14, 15, 16],
        "standing": {"t": st_t, "p": st_rows},
        "passes": passes,
    }


def delta_rows(rows: list) -> list:
    """Frames as flat integer lists: each landmark's x, y, z (19 x 3), the first frame of a run in
    full and every later frame as the change from the last frame that held the landmark; a missing
    landmark is three nulls (the next frame that holds it changes from the last value seen)."""
    out = []
    last: list = [None] * (3 * len(LANDMARKS))
    for r in rows:
        flat: list = []
        for i, pt in enumerate(r):
            for j in range(3):
                v = None if pt is None else pt[j]
                k = 3 * i + j
                if v is None:
                    flat.append(None)
                    continue
                flat.append(v if last[k] is None else v - last[k])
                last[k] = v
        out.append(flat)
    return out


def compact(fx: dict) -> str:
    """JSON with one frame per line, so a diff of a regenerated file reads frame by frame."""
    head = {k: v for k, v in fx.items() if k not in ("standing", "passes")}
    lines = ["{"]
    for k, v in head.items():
        lines.append(f"{json.dumps(k)}:{json.dumps(v, separators=(',', ':'))},")
    lines.append('"encoding":"delta",')

    def frames(t: list, p: list) -> str:
        body = ",\n".join(json.dumps(r, separators=(",", ":")) for r in delta_rows(p))
        return f'"t":{json.dumps(t, separators=(",", ":"))},\n"p":[\n{body}\n]'

    st = fx["standing"]
    lines.append('"standing":{' + frames(st["t"], st["p"]) + "},")
    lines.append('"passes":[')
    for i, ps in enumerate(fx["passes"]):
        meta = {k: v for k, v in ps.items() if k not in ("t", "p")}
        inner = ",".join(f"{json.dumps(k)}:{json.dumps(v, separators=(',', ':'))}" for k, v in meta.items())
        lines.append("{" + inner + ",\n" + frames(ps["t"], ps["p"]) + "}" + ("," if i < len(fx["passes"]) - 1 else ""))
    lines.append("]}")
    return "\n".join(lines) + "\n"


def wbds_info(cache: str) -> dict:
    path = os.path.join(cache, "wbds", "WBDSinfo.csv")
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(WBDS_INFO, path)
    info: dict = {}
    for r in csv.DictReader(open(path)):
        s = int(r["Subject"])
        d = info.setdefault(s, {**{k: r[k] for k in ("Age", "AgeGroup", "Gender", "Height", "LegLength")}, "speed": {}})
        if r["FileName"].endswith(".c3d") and "walkT" in r["FileName"]:
            d["speed"][r["FileName"]] = r["GaitSpeed(m/s)"]
    return info


def fill_stroke_trials(cache: str) -> None:
    """Stroke entries list only the folder: their static (Cal) and walking (BWA) trials, from the zip."""
    names = None
    for e in SUBSET:
        if e["source"] != "vc_st" or e["trials"]:
            continue
        names = names or members(cache, "vc_st")
        folder = f"{VC_ST}/{e['subject']}/"
        mine = sorted(n for n in names if n.startswith(folder))
        e["static"] = next(n for n in mine if "cal" in n.lower())
        e["trials"] = [n for n in mine if "cal" not in n.lower()]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", required=True, help="folder for the c3d files (kept between runs)")
    ap.add_argument("--out", default=OUT_DIR)
    ap.add_argument("--only", default=None)
    ap.add_argument("--paretic", action="store_true", help="re-derive the stroke paretic sides and print them")
    ap.add_argument("--zip", action="append", default=[], help="SOURCE=PATH, a local copy of a source zip")
    args = ap.parse_args()
    for z in args.zip:
        k, v = z.split("=", 1)
        LOCAL_ZIPS[k] = v
    fill_stroke_trials(args.cache)
    if args.paretic:
        paretic_check(args.cache)
        return
    info = wbds_info(args.cache)
    os.makedirs(args.out, exist_ok=True)
    for e in SUBSET:
        if args.only and e["id"] != args.only:
            continue
        fx = build(e, args.cache, info)
        path = os.path.join(args.out, f"{e['id']}.json")
        with open(path, "w") as f:
            f.write(compact(fx))
        n = sum(len(p["t"]) for p in fx["passes"])
        print(f"{e['id']}: {len(fx['passes'])} passes, {n} frames, {os.path.getsize(path) // 1024} KB")


def paretic_check(cache: str) -> None:
    """The paretic side of each stroke entry from the dataset's workbook (sheets in folder order)."""
    import openpyxl

    path = os.path.join(cache, "vc_st", "MAT_normalizedData_PostStrokeAdults_v27-02-23.xlsx")
    if not os.path.exists(path):
        urllib.request.urlretrieve(VC_STROKE_XLSX, path)
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    sheets = {}
    for ws in wb.worksheets[1:]:
        rows = list(ws.iter_rows(values_only=True))
        hdr = rows[0]
        d = np.array([[np.nan if v is None else float(v) for v in r] for r in rows[1:1002]])
        sheets[ws.title] = (d[::10, hdr.index("Pside_KneeAngles")], d[::10, hdr.index("Nside_KneeAngles")])
    for e in SUBSET:
        if e["source"] != "vc_st":
            continue
        curves = {"left": [], "right": []}
        for m in e["trials"]:
            tr = Trial(cached(cache, "vc_st", m))
            for side in curves:
                k = tr.points.get(("L" if side == "left" else "R") + "KneeAngles")
                if k is None:
                    continue
                ics = [ev[2] for ev in tr.events if ev[0] == side and ev[1] == "ic"]
                for a, b in zip(ics, ics[1:]):
                    ia, ib = int(round((a - tr.t0) * tr.rate)), int(round((b - tr.t0) * tr.rate))
                    seg = k[0, ia : ib + 1]
                    if ia >= 0 and ib < tr.n and np.all(np.isfinite(seg)):
                        curves[side].append(np.interp(np.linspace(0, 1, 101), np.linspace(0, 1, len(seg)), seg))
        mean = {s: np.mean(v, axis=0) for s, v in curves.items()}
        best = min(
            (np.nanmean(np.abs(mean[p] - P)) + np.nanmean(np.abs(mean[o] - N)), sheet, p)
            for sheet, (P, N) in sheets.items()
            for p, o in (("left", "right"), ("right", "left"))
        )
        print(f"{e['id']}: paretic {best[2]} ({best[1]}, mean knee curve error {best[0]:.2f} deg)")


if __name__ == "__main__":
    main()
