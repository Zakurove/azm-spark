#!/usr/bin/env python3
"""
Golden values for the v7 signal ports and angle maths (product v7 contract 6.1 and 6.2).

Dev only, never shipped. Writes, on fixed inputs:
  tests/golden/butter_filtfilt.json   SciPy butter(output="sos"), sos2tf and sosfiltfilt
  tests/golden/hampel.json            Pose2Sim hampel_filter (copied below)
  tests/golden/find_peaks.json        SciPy find_peaks (distance, prominence) and peak_prominences
  tests/golden/points_to_angles.json  Pose2Sim points_to_angles and fixed_angles, and Sports2D
                                      compute_angles_for_person (copied below) on MediaPipe poses

The TypeScript ports are compared with these files by tests/v7/a-signal-*.test.ts and
tests/v7/a-angles-*.test.ts: within 1e-9 for the filters, exactly for peak indices and within 1e-6
degrees for the angles (contract 6.2).

Usage, from the repository root (needs numpy and scipy 1.x, for example in a virtual environment:
python3 -m venv .venv && .venv/bin/pip install numpy scipy):

    python3 scripts/golden/make_golden.py

The files are written with json.dumps and then formatted with the repository's prettier (npx
prettier --write), so a run on unchanged inputs reproduces the committed files.

Every input is written into the golden file itself, so the tests never depend on how this script
draws its random numbers.

-----------------------------------------------------------------------------------------------
The functions in the section "Copied from Pose2Sim and Sports2D" are copied verbatim from:

  Pose2Sim, https://github.com/perfanalytics/pose2sim, commit
  0875d55ce0112b33f6469a2b257fb27101aa6ce9: Pose2Sim/common.py (angle_dict, points_to_angles,
  fixed_angles, add_shoulder_neck_hip_coords) and Pose2Sim/filtering.py (hampel_filter).
  File headers: __author__ = "David Pagnon", __copyright__ = "Copyright 2021, Maya-Mocap"
  (common.py) and "Copyright 2021, Pose2Sim" (filtering.py), __license__ = "BSD 3-Clause License".

  Sports2D, https://github.com/davidpagnon/Sports2D, commit
  4392177d75dff43b4da60514d3766029201a5c5e: Sports2D/process.py (compute_angle,
  compute_angles_for_person). File header: __author__ = "David Pagnon, HunMin Kim",
  __copyright__ = "Copyright 2023, Sports2D", __license__ = "BSD 3-Clause License".

Both repositories carry this licence (their LICENSE files are identical):

  BSD 3-Clause License

  Copyright (c) 2022, perfanalytics
  All rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions are met:

  1. Redistributions of source code must retain the above copyright notice, this
     list of conditions and the following disclaimer.

  2. Redistributions in binary form must reproduce the above copyright notice,
     this list of conditions and the following disclaimer in the documentation
     and/or other materials provided with the distribution.

  3. Neither the name of the copyright holder nor the names of its
     contributors may be used to endorse or promote products derived from
     this software without specific prior written permission.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
  DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
  FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
  DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
  SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
  CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
  OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Modified for Azm: nothing inside the copied functions; only the BLAZEPOSE keypoint names and ids
(Pose2Sim/skeletons.py, same commit) are written out as two lists, and the calls below are ours.
SciPy and NumPy are imported, not copied.
-----------------------------------------------------------------------------------------------
"""

import json
import math
import os
import shutil
import subprocess
import sys

import numpy as np
import scipy
from scipy import signal

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "tests", "golden")


# ============================================================================================
# Copied from Pose2Sim and Sports2D (BSD 3-Clause, notice above). Verbatim.
# ============================================================================================

## CONSTANTS
# 4 points joint angle: between knee and ankle, and toe and heel. Add 90° offset and multiply by -1
# 3 points joint angle: between ankle, knee, hip. -180° offset, multiply by -1
# 2 points segment angle: between horizontal and ankle and knee, 0° offset, multiply by 1 (except trunk and head: -1)
angle_dict = { # lowercase!
    # joint angles
    'right ankle': [['RKnee', 'RAnkle', 'RBigToe', 'RHeel'], 'dorsiflexion', 90, 1],
    'left ankle': [['LKnee', 'LAnkle', 'LBigToe', 'LHeel'], 'dorsiflexion', 90, 1],
    'right knee': [['RAnkle', 'RKnee', 'RHip'], 'flexion', -180, 1],
    'left knee': [['LAnkle', 'LKnee', 'LHip'], 'flexion', -180, 1],
    'right hip': [['RKnee', 'RHip', 'Hip', 'Neck'], 'flexion', 0, -1],
    'left hip': [['LKnee', 'LHip', 'Hip', 'Neck'], 'flexion', 0, -1],
    # 'lumbar': [['Neck', 'Hip', 'RHip', 'LHip'], 'flexion', -180, -1],
    # 'neck': [['Head', 'Neck', 'RShoulder', 'LShoulder'], 'flexion', -180, -1],
    'right shoulder': [['RElbow', 'RShoulder', 'Hip', 'Neck'], 'flexion', 0, -1],
    'left shoulder': [['LElbow', 'LShoulder', 'Hip', 'Neck'], 'flexion', 0, -1],
    'right elbow': [['RWrist', 'RElbow', 'RShoulder'], 'flexion', 180, -1],
    'left elbow': [['LWrist', 'LElbow', 'LShoulder'], 'flexion', 180, -1],
    'right wrist': [['RElbow', 'RWrist', 'RIndex'], 'flexion', -180, 1],
    'left wrist': [['LElbow', 'LIndex', 'LWrist'], 'flexion', -180, 1],

    # segment angles
    'right foot': [['RBigToe', 'RHeel'], 'horizontal', 0, -1],
    'left foot': [['LBigToe', 'LHeel'], 'horizontal', 0, -1],
    'right shank': [['RAnkle', 'RKnee'], 'horizontal', 0, -1],
    'left shank': [['LAnkle', 'LKnee'], 'horizontal', 0, -1],
    'right thigh': [['RKnee', 'RHip'], 'horizontal', 0, -1],
    'left thigh': [['LKnee', 'LHip'], 'horizontal', 0, -1],
    'pelvis': [['LHip', 'RHip'], 'horizontal', 0, -1],
    'trunk': [['Neck', 'Hip'], 'horizontal', 0, -1],
    'shoulders': [['LShoulder', 'RShoulder'], 'horizontal', 0, -1],
    'head': [['Head', 'Neck'], 'horizontal', 0, -1],
    'right arm': [['RElbow', 'RShoulder'], 'horizontal', 0, -1],
    'left arm': [['LElbow', 'LShoulder'], 'horizontal', 0, -1],
    'right forearm': [['RWrist', 'RElbow'], 'horizontal', 0, -1],
    'left forearm': [['LWrist', 'LElbow'], 'horizontal', 0, -1],
    'right hand': [['RIndex', 'RWrist'], 'horizontal', 0, -1],
    'left hand': [['LIndex', 'LWrist'], 'horizontal', 0, -1]
    }


def add_shoulder_neck_hip_coords(kpt_name, p_X, p_Y, p_scores, kpt_ids, kpt_names):
    '''
    Adding kpt_name if missing from kpt_names:
    - shoulder: hip + dist(knee,hip) in -Y direction
    - neck: midshoulder
    - hip: midhip
    
    INPUTS:
    - kpt_name: name of the keypoint to add (neck, hip)
    - p_X: list of x coordinates after flipping if needed
    - p_Y: list of y coordinates
    - p_scores: list of confidence scores
    - kpt_ids: list of keypoint ids (see skeletons.py)
    - kpt_names: list of keypoint names (see skeletons.py)
    
    OUTPUTS:
    - p_X: list of x coordinates with added missing coordinate
    - p_Y: list of y coordinates with added missing coordinate
    - p_scores: list of confidence scores with added missing score
    '''

    names, ids = kpt_names.copy(), kpt_ids.copy()
    names.append(kpt_name)
    ids.append(len(p_X))

    if kpt_name in ['RShoulder', 'LShoulder']:
        rknee_coords = (p_X[ids[names.index('RKnee')]], p_Y[ids[names.index('RKnee')]])
        rhip_coords = (p_X[ids[names.index('RHip')]], p_Y[ids[names.index('RHip')]])
        lhip_coords = (p_X[ids[names.index('LHip')]], p_Y[ids[names.index('LHip')]])
        lknee_coords = (p_X[ids[names.index('LKnee')]], p_Y[ids[names.index('LKnee')]])
        knee_hip_dist = np.mean([euclidean_distance(rknee_coords, rhip_coords), euclidean_distance(lknee_coords, lhip_coords)])
        if kpt_name == 'LShoulder':
            lshoulder_X = lhip_coords[0]
            lshoulder_Y = lhip_coords[1] - 1.4 * knee_hip_dist
            lshoulder_score = (p_scores[ids[names.index('LKnee')]] + p_scores[ids[names.index('LHip')]])/2
            new_p_X = np.append(p_X, lshoulder_X)
            new_p_Y = np.append(p_Y, lshoulder_Y)
            new_p_score = np.append(p_scores, lshoulder_score)
        elif kpt_name == 'RShoulder':
            rshoulder_X = rhip_coords[0]
            rshoulder_Y = rhip_coords[1] - 1.4 * knee_hip_dist
            rshoulder_score = (p_scores[ids[names.index('RKnee')]] + p_scores[ids[names.index('LHip')]])/2
            new_p_X = np.append(p_X, rshoulder_X)
            new_p_Y = np.append(p_Y, rshoulder_Y)
            new_p_score = np.append(p_scores, rshoulder_score)

    elif kpt_name == 'Neck':
        new_p_X = (np.abs(p_X[ids[names.index('LShoulder')]]) + np.abs(p_X[ids[names.index('RShoulder')]])) /2
        new_p_Y = (p_Y[ids[names.index('LShoulder')]] + p_Y[ids[names.index('RShoulder')]])/2
        new_p_score = (p_scores[ids[names.index('LShoulder')]] + p_scores[ids[names.index('RShoulder')]])/2

    elif kpt_name == 'Hip':
        new_p_X = (np.abs(p_X[ids[names.index('LHip')]]) + np.abs(p_X[ids[names.index('RHip')]]) ) /2
        new_p_Y = (p_Y[ids[names.index('LHip')]] + p_Y[ids[names.index('RHip')]])/2
        new_p_score = (p_scores[ids[names.index('LHip')]] + p_scores[ids[names.index('RHip')]])/2
    
    else:
        raise ValueError("kpt_name must be 'Neck' or 'Hip'")
    
    p_X = np.append(p_X, new_p_X)
    p_Y = np.append(p_Y, new_p_Y)
    p_scores = np.append(p_scores, new_p_score)

    return p_X, p_Y, p_scores


def points_to_angles(points_list):
    '''
    If len(points_list)==2, computes clockwise angle of ab vector w.r.t. horizontal (e.g. RBigToe, RHeel) 
    If len(points_list)==3, computes clockwise angle from a to c around b (e.g. Neck, Hip, Knee) 
    If len(points_list)==4, computes clockwise angle between vectors ab and cd (e.g. Neck Hip, RKnee RHip)
    
    Points can be 2D or 3D.
    If parameters are float, returns a float between -180.0 and 180.0
    If parameters are arrays, returns an array of floats between -180.0 and 180.0

    INPUTS:
    - points_list: list of arrays of points

    OUTPUTS:
    - ang_deg: float or array of floats. The angle(s) in degrees.
    '''

    if len(points_list) < 2: # if not enough points, return None
        return np.nan
    
    points_array = np.array(points_list)
    dimensions = points_array.shape[-1]

    if len(points_list) == 2:
        vector_u = points_array[0] - points_array[1]
        if dimensions == 2:
            # Segment angle w.r.t. horizontal: atan2(dy, dx) directly
            ang = np.arctan2(vector_u[1], vector_u[0])
            ang_deg = np.degrees(ang)
            return ang_deg
        else:
            if len(points_array.shape)==2:
                vector_v = np.array([1, 0, 0])
            else:
                vector_v = np.array([[1, 0, 0],] * points_array.shape[1])

    elif len(points_list) == 3:
        vector_u = points_array[0] - points_array[1]
        vector_v = points_array[2] - points_array[1]

    elif len(points_list) == 4:
        vector_u = points_array[1] - points_array[0]
        vector_v = points_array[3] - points_array[2]

    else:
        return np.nan

    if dimensions == 2:
        # atan2(cross, dot) gives angle from u to v (CCW positive).
        # Negate to get angle from v to u, matching the old atan2(u)-atan2(v) convention.
        # Range: (-180, 180) instead of (-360, 360), eliminating discontinuities.
        cross = vector_u[0] * vector_v[1] - vector_u[1] * vector_v[0]
        dot = vector_u[0] * vector_v[0] + vector_u[1] * vector_v[1]
        ang = -np.arctan2(cross, dot)
    else:
        cross_product = np.cross(vector_u, vector_v)
        dot_product = np.einsum('ij,ij->i', vector_u, vector_v) # np.dot(vector_u, vector_v) does not work with time series
        ang = np.arctan2(np.linalg.norm(cross_product, axis=-1), dot_product)

    ang_deg = np.degrees(ang)
    
    return ang_deg


def fixed_angles(points_list, ang_name):
    '''
    Compute angle and apply offset and scaling factor.
    Wraps result to (-180, 180] for most angles, or (-90, 90] for pelvis/shoulders.

    INPUTS:
    - points_list: list of arrays of points
    - ang_name: str. The name of the angle to consider.

    OUTPUTS:
    - ang: float. The angle in degrees.
    '''

    ang_params = angle_dict[ang_name]
    ang = points_to_angles(points_list)
    ang = (ang + ang_params[2]) * ang_params[3]
    
    if ang_name in ['pelvis', 'shoulders']:
        ang = (ang + 90) % 180 - 90
    else:
        ang = (ang + 180) % 360 - 180

    return ang


def hampel_filter(col, window_size=7, n_sigma=2):
    '''
    Hampel filter for outlier rejection before other filtering methods.
    Takes a sliding window of size 7, calculates its median and standard deviation, 
    replaces value by median if difference is more than 2 times the standard deviation (95% confidence interval), 
    else keeps the value.
    '''

    col_filtered = col.copy()
    half_window = window_size // 2
    
    for i in range(half_window, len(col) - half_window):
        window = col[i-half_window:i+half_window+1]
        median = np.median(window)
        mad = np.median(np.abs(window - median))  # Median Absolute Deviation
        
        if mad != 0:
            modified_z_score = 0.6745 * (col[i] - median) / mad #75% percentile from median
            if np.abs(modified_z_score) > n_sigma:
                col_filtered[i] = median
    
    return col_filtered


def compute_angle(ang_name, person_X_flipped, person_Y, angle_dict, keypoints_ids, keypoints_names):
    '''
    Compute the angles from the 2D coordinates of the keypoints.
    Takes into account which side the participant is facing.
    Takes into account the offset and scaling of the angle from angle_dict.
    Requires points_to_angles function (see common.py in Pose2Sim)

    INPUTS:
    - ang_name: str. The name of the angle to compute
    - person_X_flipped: list of x coordinates after flipping if needed
    - person_Y: list of y coordinates
    - angle_dict: dict. The dictionary of angles to compute (name: [keypoints, type, offset, scaling])
    - keypoints_ids: list of keypoint ids (see skeletons.py)
    - keypoints_names: list of keypoint names (see skeletons.py)

    OUTPUTS:
    - ang: float. The computed angle
    '''

    ang_params = angle_dict.get(ang_name)
    if ang_params is not None:
        try:
            angle_coords = [[person_X_flipped[keypoints_ids[keypoints_names.index(kpt)]], person_Y[keypoints_ids[keypoints_names.index(kpt)]]] for kpt in ang_params[0]]
            ang = fixed_angles(angle_coords, ang_name)
        except:
            ang = np.nan    
    else:
        ang = np.nan
    
    return ang


def compute_angles_for_person(person_X, person_Y, visible_side_str, has_toe_heel, 
                               keypoints_ids, keypoints_names, angle_names, angle_dict,
                               L_R_direction_idx=None):
    '''
    Determine visible side, flip X coordinates, and compute angles for a single
    person on a single frame.

    INPUTS:
    - person_X: np.array. X coordinates of keypoints
    - person_Y: np.array. Y coordinates of keypoints
    - visible_side_str: str. 'auto', 'right', 'left', 'front', 'back', or 'none'
    - has_toe_heel: bool. Whether toe/heel keypoints are available
    - keypoints_ids: list of int. Keypoint indices (contiguous 0..N-1)
    - keypoints_names: list of str. Keypoint names
    - angle_names: list of str. Angle names to compute
    - angle_dict: dict. Angle definitions
    - L_R_direction_idx: list of 4 ints [Ltoe, LHeel, Rtoe, RHeel] positions in
      keypoints_names, or None

    OUTPUTS:
    - person_X_flipped: np.array. Flipped X coordinates
    - person_angles: list of float. Computed angles
    - person_visible_side_frame: str. The resolved visible side for this frame
    '''

    # Determine visible side for this frame
    if visible_side_str == 'auto':
        if has_toe_heel and L_R_direction_idx is not None:
            Ltoe_idx, LHeel_idx, Rtoe_idx, RHeel_idx = L_R_direction_idx
            right_orientation = person_X[Rtoe_idx] - person_X[RHeel_idx]
            left_orientation = person_X[Ltoe_idx] - person_X[LHeel_idx]
            global_orientation = right_orientation + left_orientation
            person_visible_side_frame = 'right' if global_orientation >= 0 else 'left'
        else:
            person_visible_side_frame = 'right'
    else:
        person_visible_side_frame = visible_side_str

    # Flip X coordinates
    if person_visible_side_frame in ['right', 'none']:
        person_X_flipped = person_X.copy()
    elif person_visible_side_frame == 'left':
        person_X_flipped = -person_X.copy()
    elif person_visible_side_frame in ['front', 'back']:
        negate_prefix = 'R' if person_visible_side_frame == 'front' else 'L'
        person_X_flipped = person_X.copy()
        for k in keypoints_names:
            if k.startswith(negate_prefix):
                keypt_idx = keypoints_ids[keypoints_names.index(k)]
                person_X_flipped[keypt_idx] = -person_X_flipped[keypt_idx]
    else:
        person_X_flipped = person_X.copy()

    # Compute angles
    person_angles = []
    for ang_name in angle_names:
        ang_params = angle_dict.get(ang_name)
        kpts = ang_params[0]
        if not any(item not in keypoints_names for item in kpts):
            ang = compute_angle(ang_name, person_X_flipped, person_Y, angle_dict, keypoints_ids, keypoints_names)
        else:
            ang = np.nan
        person_angles.append(ang)

    return person_X_flipped, person_angles, person_visible_side_frame


# ============================================================================================
# End of the copied functions. Everything below is Azm code.
# ============================================================================================

# Pose2Sim/skeletons.py BLAZEPOSE, written out (name, MediaPipe id). "Hip" has no id there: Sports2D
# adds Hip and Neck as midpoints (add_shoulder_neck_hip_coords) before it computes the angles.
BLAZEPOSE = [
    ("RHip", 24), ("RKnee", 26), ("RAnkle", 28), ("RHeel", 30), ("RBigToe", 32),
    ("LHip", 23), ("LKnee", 25), ("LAnkle", 27), ("LHeel", 29), ("LBigToe", 31),
    ("Nose", 0), ("REye", 5), ("LEye", 2),
    ("RShoulder", 12), ("RElbow", 14), ("RWrist", 16), ("RPinky", 18), ("RIndex", 20), ("RThumb", 22),
    ("LShoulder", 11), ("LElbow", 13), ("LWrist", 15), ("LPinky", 17), ("LIndex", 19), ("LThumb", 21),
]

# Our left wrist: the vertex at the wrist, as the right wrist (contract 2.3: the upstream left wrist
# ['LElbow', 'LIndex', 'LWrist'] is not copied).
AZM_LEFT_WRIST = ['LElbow', 'LWrist', 'LIndex']

# The 33 MediaPipe landmarks of a person facing the image right, seen from the side, in pixels of a
# 1080 x 1920 portrait picture (y down). Only a starting point: every pose is jittered below.
SIDE_TEMPLATE = {
    0: (600, 300), 1: (590, 285), 2: (585, 285), 3: (575, 285), 4: (592, 286), 5: (588, 286),
    6: (580, 286), 7: (545, 300), 8: (548, 302), 9: (595, 325), 10: (594, 326),
    11: (540, 420), 12: (545, 425), 13: (545, 600), 14: (550, 605), 15: (560, 760), 16: (565, 765),
    17: (565, 800), 18: (570, 805), 19: (575, 805), 20: (580, 810), 21: (570, 790), 22: (575, 795),
    23: (530, 830), 24: (535, 835), 25: (545, 1150), 26: (550, 1155), 27: (535, 1450), 28: (540, 1455),
    29: (505, 1490), 30: (510, 1495), 31: (610, 1500), 32: (615, 1505),
}
# The same person facing the phone (front view): the person's left is on the image right.
FRONT_TEMPLATE = {
    0: (540, 300), 1: (555, 285), 2: (562, 285), 3: (570, 285), 4: (525, 285), 5: (518, 285),
    6: (510, 285), 7: (585, 300), 8: (495, 300), 9: (552, 330), 10: (528, 330),
    11: (630, 420), 12: (450, 420), 13: (660, 600), 14: (420, 600), 15: (670, 760), 16: (410, 760),
    17: (675, 800), 18: (405, 800), 19: (672, 805), 20: (408, 805), 21: (665, 790), 22: (415, 790),
    23: (590, 830), 24: (490, 830), 25: (595, 1150), 26: (485, 1150), 27: (598, 1450), 28: (482, 1450),
    29: (600, 1480), 30: (480, 1480), 31: (605, 1520), 32: (475, 1520),
}


def r6(x):
    """Inputs are rounded to 6 decimals before use, so the file holds them exactly."""
    return float(round(float(x), 6))


def num(x):
    """A float for JSON: NaN as null (the tests read null as NaN), -0 as 0."""
    x = float(x)
    if math.isnan(x):
        return None
    return x + 0.0


def nums(xs):
    return [num(x) for x in xs]


def butter_filtfilt(rng):
    fs = 30.0
    t = np.arange(300) / fs
    base = 100 + 20 * np.sin(2 * np.pi * 0.8 * t) + 5 * np.sin(2 * np.pi * 7.0 * t) + rng.normal(0, 2, t.size)
    x300 = np.array([r6(v) for v in base])
    t600 = np.arange(600) / 60.0
    x600 = np.array([r6(v) for v in 40 * np.sin(2 * np.pi * 1.1 * t600) + rng.normal(0, 1.5, t600.size)])
    step = np.array([0.0] * 40 + [30.0] * 40)
    short = np.array([r6(v) for v in rng.normal(10, 3, 12)])
    cases = [
        ("gait smoothing: 2nd order at 5 Hz, filtfilt (4th order zero lag)", 2, 5.0, 30.0, x300),
        ("Pose2Sim default: 2nd order at 6 Hz", 2, 6.0, 30.0, x300),
        ("4th order at 6 Hz", 4, 6.0, 30.0, x300),
        ("odd order 3 at 5 Hz (shorter SciPy pad)", 3, 5.0, 30.0, x300),
        ("1st order at 4 Hz", 1, 4.0, 30.0, x300),
        ("6th order at 3 Hz", 6, 3.0, 30.0, x300),
        ("4th order at 5 Hz, 60 Hz frames", 4, 5.0, 60.0, x600),
        ("step", 2, 5.0, 30.0, step),
        ("12 samples, 3 more than the pad", 2, 6.0, 30.0, short),
    ]
    out = []
    for name, order, fc, fs_, x in cases:
        sos = signal.butter(order, fc, btype="low", fs=fs_, output="sos")
        b, a = signal.sos2tf(sos)
        y = signal.sosfiltfilt(sos, x)
        out.append({
            "name": name, "order": order, "cutoffHz": fc, "fs": fs_,
            "sos": [nums(row) for row in sos], "b": nums(b), "a": nums(a),
            "x": nums(x), "y": nums(y),
        })
    return {"cases": out}


def hampel(rng):
    n = 200
    walk = np.cumsum(rng.normal(0, 1, n)) + 50
    spikes = walk.copy()
    for i in rng.choice(np.arange(5, n - 5), 12, replace=False):
        spikes[i] += rng.choice([-1, 1]) * rng.uniform(8, 25)
    spikes = np.array([r6(v) for v in spikes])
    flat = np.array([r6(v) for v in [5.0] * 10 + [40.0] + [5.0] * 10])
    with_nan = spikes[:40].copy()
    with_nan[[12, 25]] = np.nan
    plateau_noise = np.array([r6(v) for v in np.round(rng.normal(0, 1, 60), 1) + 90])
    cases = [
        ("random walk with spikes, defaults", spikes, 7, 2),
        ("window 5, n sigma 3", spikes, 5, 3),
        ("even window 6 (half window 3, as upstream)", spikes, 6, 2),
        ("window 9, n sigma 1.5", spikes, 9, 1.5),
        ("a spike on a flat signal: MAD 0, kept", flat, 7, 2),
        ("NaN inside: windows with NaN never replace", with_nan, 7, 2),
        ("shorter than the window", spikes[:5], 7, 2),
        ("values with ties (one decimal)", plateau_noise, 7, 2),
    ]
    out = []
    for name, x, window, n_sigma in cases:
        y = hampel_filter(x.astype(float), window_size=window, n_sigma=n_sigma)
        out.append({"name": name, "window": window, "nSigma": n_sigma, "x": nums(x), "y": nums(y)})
    return {"cases": out}


def find_peaks_cases(rng):
    fs = 30.0
    t = np.arange(300) / fs
    gait = np.array([r6(v) for v in 0.25 * np.sin(2 * np.pi * 0.9 * t) + 0.05 * np.sin(2 * np.pi * 2.7 * t)
                     + rng.normal(0, 0.01, t.size)])
    noise = np.array([r6(v) for v in rng.normal(0, 1, 200)])
    plateaus = np.array([0, 1, 1, 1, 0, 2, 2, 0, 3, 3, 3, 3, 1, 0, 0, 4, 0, 4, 4, 0], dtype=float)
    ties = np.array([0, 5, 0, 5, 0, 5, 0, 5, 0, 5, 0], dtype=float)
    edges = np.array([9, 1, 2, 1, 0, 3, 0, 1, 8], dtype=float)
    rng_range = float(np.max(gait) - np.min(gait))
    cases = [
        ("noise, no condition", noise, None, None),
        ("noise, distance 5", noise, 5, None),
        ("noise, distance 2.5 (rounded up to 3)", noise, 2.5, None),
        ("noise, prominence 1", noise, None, 1.0),
        ("noise, distance 4 and prominence 0.8", noise, 4, 0.8),
        ("gait like ankle signal, distance 0.4 s and prominence 10% of the range (myogait Zeni)", gait, 12,
         r6(0.1 * rng_range)),
        ("plateaus (midpoint rounded down)", plateaus, None, None),
        ("plateaus, distance 3", plateaus, 3, None),
        ("ties within the distance", ties, 3, None),
        ("ties, distance 5", ties, 5, None),
        ("peaks at the edges are not peaks", edges, None, None),
        ("prominence on a short signal", edges, None, 1.5),
    ]
    out = []
    for name, x, distance, prominence in cases:
        kw = {}
        if distance is not None:
            kw["distance"] = distance
        if prominence is not None:
            kw["prominence"] = prominence
        peaks, props = signal.find_peaks(x, **kw)
        prom = props["prominences"] if "prominences" in props else signal.peak_prominences(x, peaks)[0]
        case = {"name": name, "x": nums(x), "peaks": [int(p) for p in peaks], "prominences": nums(prom)}
        if distance is not None:
            case["distance"] = distance
        if prominence is not None:
            case["prominence"] = prominence
        out.append(case)
    return {"cases": out}


def jittered(template, rng, spread):
    return {i: (r6(x + rng.normal(0, spread)), r6(y + rng.normal(0, spread))) for i, (x, y) in template.items()}


def mirrored(pose, width=1080.0):
    """The same person facing the other way (x mirrored), labels kept."""
    return {i: (r6(width - x), y) for i, (x, y) in pose.items()}


# The angles of the Sports2D cases, in this order (snake case ids; "head" needs a Head keypoint, which
# BlazePose does not have, so Sports2D returns NaN for it and it is left out). left_wrist_azm is our
# left wrist.
ANGLE_IDS = [a.replace(" ", "_") for a in angle_dict if a != "head"] + ["left_wrist_azm"]


def sports2d_angles(pose, visible_side):
    names = [n for n, _ in BLAZEPOSE]
    ids = list(range(len(BLAZEPOSE)))
    X = np.array([pose[i][0] for _, i in BLAZEPOSE], dtype=float)
    Y = np.array([pose[i][1] for _, i in BLAZEPOSE], dtype=float)
    S = np.ones(len(BLAZEPOSE))
    for kpt in ["Hip", "Neck"]:
        X, Y, S = add_shoulder_neck_hip_coords(kpt, X, Y, S, ids, names)
        names.append(kpt)
        ids.append(len(X) - 1)
    lr = [names.index("LBigToe"), names.index("LHeel"), names.index("RBigToe"), names.index("RHeel")]
    angle_names = [a for a in angle_dict if a != "head"]
    X_flipped, angles, side = compute_angles_for_person(X, Y, visible_side, True, ids, names, angle_names,
                                                        angle_dict, L_R_direction_idx=lr)
    result = [num(v) for v in angles]
    # Our left wrist (vertex at the wrist), with the copied points_to_angles on the flipped x and the
    # wrist's offset (-180) and scale (1).
    coords = [[X_flipped[ids[names.index(k)]], Y[ids[names.index(k)]]] for k in AZM_LEFT_WRIST]
    ang = (points_to_angles(coords) - 180) * 1
    result.append(num((ang + 180) % 360 - 180))
    return side, result


def flat(points):
    return [v for p in points for v in p]


def points_cases(rng):
    point_sets = []
    for k in (2, 3, 4):
        for _ in range(60):
            pts = [[r6(v) for v in rng.uniform(-2, 2, 2)] for _ in range(k)]
            point_sets.append({"points": flat(pts), "angle": num(points_to_angles(pts))})
    # Exact directions and a zero length vector.
    for pts in ([[1, 0], [0, 0]], [[0, 1], [0, 0]], [[-1, 0], [0, 0]], [[0, -1], [0, 0]], [[0, 0], [0, 0]],
                [[1, 0], [0, 0], [0, 1]], [[0, 1], [0, 0], [1, 0]], [[0, 0], [1, 0], [0, 0], [0, 1]]):
        point_sets.append({"points": flat(pts), "angle": num(points_to_angles(pts))})

    fixed = []
    for name, (_, _, offset, scale) in angle_dict.items():
        if name == "head":
            continue
        n_points = len(angle_dict[name][0])
        for _ in range(6):
            pts = [[r6(v) for v in rng.uniform(0, 1000, 2)] for _ in range(n_points)]
            fixed.append({"name": name.replace(" ", "_"), "points": flat(pts), "offset": offset, "scale": scale,
                          "angle": num(points_to_angles(pts)), "fixed": num(fixed_angles(pts, name))})

    poses = []
    for template, sides, spread in ((SIDE_TEMPLATE, ["auto", "right", "left", "none"], 40),
                                    (FRONT_TEMPLATE, ["front", "back", "auto"], 30)):
        for _ in range(6):
            pose = jittered(template, rng, spread)
            for p in (pose, mirrored(pose)):
                results = []
                for vs in sides:
                    side, angles = sports2d_angles(p, vs)
                    results.append({"visibleSide": vs, "resolved": side, "angles": angles})
                poses.append({"pose": flat(p[i] for i in range(33)), "results": results})
    return {"pointsToAngle": point_sets, "fixedAngle": fixed, "angleIds": ANGLE_IDS, "sports2d": poses}


def write(name, data):
    data = {
        "generator": "scripts/golden/make_golden.py",
        "numpy": np.__version__,
        "scipy": scipy.__version__,
        **data,
    }
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf8") as f:
        f.write(json.dumps(data, ensure_ascii=False, allow_nan=False))
        f.write("\n")
    return path


def main():
    if not scipy.__version__.startswith("1."):
        sys.exit(f"SciPy 1.x expected, found {scipy.__version__}")
    os.makedirs(OUT, exist_ok=True)
    rng = np.random.default_rng(20261004)
    paths = [
        write("butter_filtfilt.json", butter_filtfilt(rng)),
        write("hampel.json", hampel(rng)),
        write("find_peaks.json", find_peaks_cases(rng)),
        write("points_to_angles.json", points_cases(rng)),
    ]
    npx = shutil.which("npx")
    if npx:
        subprocess.run([npx, "prettier", "--write", *paths], cwd=ROOT, check=True)
    else:
        print("npx not found: run npx prettier --write tests/golden before committing")
    for p in paths:
        print("wrote", os.path.relpath(p, ROOT))


if __name__ == "__main__":
    main()
