/** Impact of a problem found in a program. */
export enum DiagnosticSeverity {
  /** The program must not be executed. */
  Error = 'error',
  /** The program may run, but the preview or export may differ from the machine's behavior. */
  Warning = 'warning',
}

/**
 * Machine-readable problem identifier.
 * The domain only reports codes; turning them into text is the job of the presentation layer.
 */
export enum DiagnosticCode {
  UnterminatedComment = 'unterminated-comment',
  MissingNumber = 'missing-number',
  UnexpectedCharacter = 'unexpected-character',
  DuplicateWord = 'duplicate-word',
  InvalidFeedRate = 'invalid-feed-rate',
  MissingFeedRate = 'missing-feed-rate',
  MissingMotionMode = 'missing-motion-mode',
  UnsupportedCommand = 'unsupported-command',
  UnsupportedAxis = 'unsupported-axis',
  CutterCompensationIgnored = 'cutter-compensation-ignored',
  MachineCoordinatesApproximated = 'machine-coordinates-approximated',
  CodeAfterProgramEnd = 'code-after-program-end',
  ArcMissingParameters = 'arc-missing-parameters',
  ArcZeroRadius = 'arc-zero-radius',
  ArcRadiusMismatch = 'arc-radius-mismatch',
  ArcRadiusTooSmall = 'arc-radius-too-small',
  ArcFullCircleByRadius = 'arc-full-circle-by-radius',
  ArcRadiusAndCenterConflict = 'arc-radius-and-center-conflict',
  DrillCycleMissingParameters = 'drill-cycle-missing-parameters',
  DrillCycleIncrementalUnsupported = 'drill-cycle-incremental-unsupported',
}

/** Severity assigned to each code, kept in one place so the rules stay consistent. */
const SEVERITY_BY_CODE: Readonly<Record<DiagnosticCode, DiagnosticSeverity>> = {
  [DiagnosticCode.UnterminatedComment]: DiagnosticSeverity.Warning,
  [DiagnosticCode.MissingNumber]: DiagnosticSeverity.Error,
  [DiagnosticCode.UnexpectedCharacter]: DiagnosticSeverity.Error,
  [DiagnosticCode.DuplicateWord]: DiagnosticSeverity.Warning,
  [DiagnosticCode.InvalidFeedRate]: DiagnosticSeverity.Error,
  [DiagnosticCode.MissingFeedRate]: DiagnosticSeverity.Warning,
  [DiagnosticCode.MissingMotionMode]: DiagnosticSeverity.Error,
  [DiagnosticCode.UnsupportedCommand]: DiagnosticSeverity.Warning,
  [DiagnosticCode.UnsupportedAxis]: DiagnosticSeverity.Warning,
  [DiagnosticCode.CutterCompensationIgnored]: DiagnosticSeverity.Warning,
  [DiagnosticCode.MachineCoordinatesApproximated]: DiagnosticSeverity.Warning,
  [DiagnosticCode.CodeAfterProgramEnd]: DiagnosticSeverity.Warning,
  [DiagnosticCode.ArcMissingParameters]: DiagnosticSeverity.Error,
  [DiagnosticCode.ArcZeroRadius]: DiagnosticSeverity.Error,
  [DiagnosticCode.ArcRadiusMismatch]: DiagnosticSeverity.Error,
  [DiagnosticCode.ArcRadiusTooSmall]: DiagnosticSeverity.Error,
  [DiagnosticCode.ArcFullCircleByRadius]: DiagnosticSeverity.Error,
  [DiagnosticCode.ArcRadiusAndCenterConflict]: DiagnosticSeverity.Warning,
  [DiagnosticCode.DrillCycleMissingParameters]: DiagnosticSeverity.Error,
  [DiagnosticCode.DrillCycleIncrementalUnsupported]: DiagnosticSeverity.Warning,
};

/** Values that make a diagnostic specific; which fields are set depends on the code. */
export interface DiagnosticDetails {
  /** Offending word as written in the program, for example `G38.2`. */
  readonly word?: string;
  /** Offending character or address letter. */
  readonly character?: string;
  readonly startRadiusMm?: number;
  readonly endRadiusMm?: number;
  readonly radiusMm?: number;
  readonly halfChordMm?: number;
}

/** Problem found in a program, anchored to its source position. */
export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  /** One-based source line. */
  readonly line: number;
  /** One-based character position in the line. */
  readonly column: number;
  readonly details: DiagnosticDetails;
}

/** Creates a diagnostic with the severity defined for its code. */
export const createDiagnostic = (
  code: DiagnosticCode,
  line: number,
  column: number,
  details: DiagnosticDetails = {},
): Diagnostic => ({ severity: SEVERITY_BY_CODE[code], code, line, column, details });
