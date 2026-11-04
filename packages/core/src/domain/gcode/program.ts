import type { Vector3 } from '@core/domain/geometry/vector3';
import type { Diagnostic } from './diagnostics';
import { DiagnosticSeverity } from './diagnostics';

/**
 * Plane an arc is interpolated in.
 * Each value spells a right-handed pair of in-plane axes, so that a positive rotation
 * in the plane is counter-clockwise when viewed from the positive normal.
 */
export enum ArcPlane {
  /** Selected by `G17`. */
  XY = 'xy',
  /** Selected by `G18`. */
  ZX = 'zx',
  /** Selected by `G19`. */
  YZ = 'yz',
}

/** Discriminator of {@link ProgramStep}. */
export enum ProgramStepKind {
  LinearMove = 'linear-move',
  ArcMove = 'arc-move',
  Auxiliary = 'auxiliary',
}

/** Straight tool movement. */
export interface LinearMove {
  readonly kind: ProgramStepKind.LinearMove;
  /** `true` for a non-cutting `G0` traverse. */
  readonly isRapid: boolean;
  readonly start: Vector3;
  readonly end: Vector3;
  /** Feed rate in mm/min; `null` for rapids and when the program has not set one yet. */
  readonly feedRate: number | null;
  /** One-based source line. */
  readonly sourceLine: number;
}

/** Circular or helical tool movement. */
export interface ArcMove {
  readonly kind: ProgramStepKind.ArcMove;
  readonly isClockwise: boolean;
  readonly plane: ArcPlane;
  readonly start: Vector3;
  readonly end: Vector3;
  readonly center: Vector3;
  /** Feed rate in mm/min; `null` when the program has not set one yet. */
  readonly feedRate: number | null;
  /** One-based source line. */
  readonly sourceLine: number;
}

/** Command without geometry (spindle, coolant, dwell...), preserved verbatim on export. */
export interface AuxiliaryStep {
  readonly kind: ProgramStepKind.Auxiliary;
  readonly commandText: string;
  /** One-based source line. */
  readonly sourceLine: number;
}

/** Tool movement of any shape. */
export type MotionStep = LinearMove | ArcMove;

/** Single executable step of a program. */
export type ProgramStep = MotionStep | AuxiliaryStep;

/** Parsed program. All coordinates are absolute and in millimeters. */
export interface GCodeProgram {
  readonly steps: readonly ProgramStep[];
  readonly diagnostics: readonly Diagnostic[];
  readonly lineCount: number;
}

/** Tells whether the program contains problems that make its execution unsafe. */
export const hasProgramErrors = (program: GCodeProgram): boolean =>
  program.diagnostics.some((diagnostic) => diagnostic.severity === DiagnosticSeverity.Error);
