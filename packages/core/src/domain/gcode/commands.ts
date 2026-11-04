/**
 * `G` commands the interpreter gives special meaning to.
 * Values are the command number multiplied by ten, which lets decimal commands
 * such as `G90.1` be compared exactly: see {@link toCommandCode}.
 */
export enum GCommand {
  RapidMove = 0,
  LinearFeed = 10,
  ArcClockwise = 20,
  ArcCounterClockwise = 30,
  Dwell = 40,
  SetCoordinateData = 100,
  SelectPlaneXY = 170,
  SelectPlaneZX = 180,
  SelectPlaneYZ = 190,
  UnitsInches = 200,
  UnitsMillimeters = 210,
  ReturnHome = 280,
  ReturnSecondaryHome = 300,
  CutterCompensationOff = 400,
  CutterCompensationLeft = 410,
  CutterCompensationLeftDynamic = 411,
  CutterCompensationRight = 420,
  CutterCompensationRightDynamic = 421,
  ToolLengthOffset = 430,
  ToolLengthOffsetCancel = 490,
  MachineCoordinates = 530,
  WorkOffset1 = 540,
  WorkOffset2 = 550,
  WorkOffset3 = 560,
  WorkOffset4 = 570,
  WorkOffset5 = 580,
  WorkOffset6 = 590,
  WorkOffset7 = 591,
  WorkOffset8 = 592,
  WorkOffset9 = 593,
  ExactStop = 610,
  ExactStopAlternative = 611,
  PathBlending = 640,
  CannedCycleCancel = 800,
  DrillCycle = 810,
  DrillCycleWithDwell = 820,
  PeckDrillCycle = 830,
  BoringCycle = 850,
  DistanceAbsolute = 900,
  ArcCenterAbsolute = 901,
  DistanceIncremental = 910,
  ArcCenterIncremental = 911,
  SetCoordinateOffset = 920,
  ClearCoordinateOffset = 921,
  FeedPerMinute = 940,
  FeedPerRevolution = 950,
  CycleRetractToInitial = 980,
  CycleRetractToPlane = 990,
}

/** `M` commands that take effect after the motion of their block. */
export enum MCommand {
  ProgramStop = 0,
  OptionalStop = 1,
  ProgramEnd = 2,
  ProgramEndAndRewind = 30,
  PalletChangeStop = 60,
}

/** Converts a `G` word's value to the numbering used by {@link GCommand}. */
export const toCommandCode = (wordValue: number): number => Math.round(wordValue * 10);

/** Commands with no effect on geometry: preserved on export without interpretation. */
export const GEOMETRY_NEUTRAL_COMMANDS: ReadonlySet<number> = new Set<GCommand>([
  GCommand.Dwell,
  GCommand.SetCoordinateData,
  GCommand.CutterCompensationOff,
  GCommand.ToolLengthOffset,
  GCommand.ToolLengthOffsetCancel,
  GCommand.WorkOffset1,
  GCommand.WorkOffset2,
  GCommand.WorkOffset3,
  GCommand.WorkOffset4,
  GCommand.WorkOffset5,
  GCommand.WorkOffset6,
  GCommand.WorkOffset7,
  GCommand.WorkOffset8,
  GCommand.WorkOffset9,
  GCommand.ExactStop,
  GCommand.ExactStopAlternative,
  GCommand.PathBlending,
  GCommand.FeedPerMinute,
  GCommand.FeedPerRevolution,
]);

/** Commands whose address words are their own parameters rather than motion targets. */
export const COMMANDS_OWNING_THEIR_WORDS: ReadonlySet<number> = new Set<GCommand>([
  GCommand.Dwell,
  GCommand.SetCoordinateData,
]);

/** Cutter compensation shifts the real path by a tool radius that the preview does not model. */
export const CUTTER_COMPENSATION_COMMANDS: ReadonlySet<number> = new Set<GCommand>([
  GCommand.CutterCompensationLeft,
  GCommand.CutterCompensationLeftDynamic,
  GCommand.CutterCompensationRight,
  GCommand.CutterCompensationRightDynamic,
]);

/** Canned drilling cycles expanded into plain moves. */
export const DRILL_CYCLE_COMMANDS: ReadonlySet<number> = new Set<GCommand>([
  GCommand.DrillCycle,
  GCommand.DrillCycleWithDwell,
  GCommand.PeckDrillCycle,
  GCommand.BoringCycle,
]);

/** `M` commands executed after the motion of their block. */
export const POST_MOTION_M_COMMANDS: ReadonlySet<number> = new Set<MCommand>([
  MCommand.ProgramStop,
  MCommand.OptionalStop,
  MCommand.ProgramEnd,
  MCommand.ProgramEndAndRewind,
  MCommand.PalletChangeStop,
]);

/** `M` commands after which nothing else in the file runs. */
export const PROGRAM_END_M_COMMANDS: ReadonlySet<number> = new Set<MCommand>([
  MCommand.ProgramEnd,
  MCommand.ProgramEndAndRewind,
]);
