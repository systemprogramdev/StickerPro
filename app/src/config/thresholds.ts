// Every tunable number lives here. Starting values from the brief; tune after real walks.
export const THRESHOLDS = {
  // Tracking
  maxAccuracyM: 25, // fixes worse than this are stored but not matched
  gapSeconds: 10, // no fix for longer than this breaks track and coverage
  distanceStepM: 5, // minimum movement counted toward walk distance

  // Matching
  matchRadiusM: 20,
  coverageSlices: 16,
  completeSlices: 14,
  shortSegmentM: 30, // shorter segments complete when passed end to end
  alleyEndM: 12, // within this of an alley end node counts as passing it
  headingWindow: 5, // recent accepted fixes used to estimate heading
  headingMinMoveM: 5, // need this much movement across the window to trust it
  headingPenaltyM: 15, // score penalty at 90 degrees off the segment axis
  sameSegmentBonusM: 5,
  farSegmentPenaltyM: 8, // candidate not the same or adjacent to the last match
  gridCellM: 200,

  // Planner
  offRouteM: 30,
  offRouteSeconds: 10,
  turnAngleDeg: 35,

  // Battery, photos, lock
  autoEndBatteryPct: 5,
  lowBatteryPct: 15,
  photoMaxPx: 1600,
  photoQuality: 0.85,
  unlockHoldMs: 2000,
  pausedNoticeMs: 8000,
} as const
