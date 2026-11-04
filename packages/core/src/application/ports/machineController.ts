import type { GeneratedBlock } from '@core/domain/gcode/generator';
import type { Vector3 } from '@core/domain/geometry/vector3';
import type { Toolpath } from '@core/domain/toolpath/toolpath';

/** Operating state of a machine. */
export enum MachineStatus {
  Idle = 'idle',
  Jogging = 'jogging',
  Homing = 'homing',
  RunningProgram = 'running-program',
  ProgramPaused = 'program-paused',
  /** Emergency-stopped or faulted: commands are refused until the operator clears the alarm. */
  Alarm = 'alarm',
}

/** What is behind a {@link MachineController}. */
export enum MachineConnectionKind {
  Simulator = 'simulator',
  Hardware = 'hardware',
}

/** Category of a problem reported while working with a machine. */
export enum MachineFaultKind {
  /** The controller rejected a command. */
  CommandRejected = 'command-rejected',
  /** The controller entered its alarm state. */
  ControllerAlarm = 'controller-alarm',
  /** The channel to the controller was lost. */
  ConnectionLost = 'connection-lost',
}

/** Last problem reported by a machine. */
export interface MachineFault {
  readonly kind: MachineFaultKind;
  /** Code from the controller's documentation; `null` for faults not reported by the controller. */
  readonly controllerCode: number | null;
}

/** Execution progress of a running program. */
export interface ProgramRunProgress {
  readonly segmentIndex: number;
  readonly segmentCount: number;
  /** Source line being executed. */
  readonly sourceLine: number;
  /** Fraction of the program completed, from `0` to `1`. */
  readonly completedFraction: number;
}

/** Snapshot of a machine. */
export interface MachineState {
  readonly connectionKind: MachineConnectionKind;
  readonly status: MachineStatus;
  /** Tool position in work coordinates, in millimeters. */
  readonly position: Vector3;
  /** `null` unless a program is running or paused. */
  readonly programProgress: ProgramRunProgress | null;
  /** `null` until a problem occurs; cleared together with the alarm. */
  readonly fault: MachineFault | null;
}

/** Parameters of a program run. */
export interface ProgramRunRequest {
  /** Geometry to follow, for machines that are simulated and for progress tracking. */
  readonly toolpath: Toolpath;
  /** G-code to stream to real controllers, including spindle and coolant commands. */
  readonly blocks: readonly GeneratedBlock[];
  readonly rapidFeedRate: number;
  readonly defaultFeedRate: number;
}

/** Called on every change of the machine state. */
export type MachineStateListener = (state: MachineState) => void;

/**
 * Output port: everything the application can ask of a machine.
 * The simulator and hardware drivers implement this same contract,
 * so use cases do not depend on what is actually connected.
 */
export interface MachineController {
  getState(): MachineState;
  /** @returns Function that cancels the subscription. */
  subscribe(listener: MachineStateListener): () => void;
  jogTo(target: Vector3, feedRate: number): void;
  /** Moves to program zero at rapid speed. */
  goHome(rapidFeedRate: number): void;
  startProgram(request: ProgramRunRequest): void;
  pauseProgram(): void;
  resumeProgram(): void;
  /** Ends the current motion in a controlled way; the machine stays ready for work. */
  stop(): void;
  /**
   * Halts immediately and locks the machine until {@link MachineController.clearAlarm}.
   * This is a software command and does not replace the machine's hardware emergency stop.
   */
  emergencyStop(): void;
  clearAlarm(): void;
  /** Sets the multiplier applied to commanded speeds. Implementations limit it to what they support. */
  setSpeedMultiplier(multiplier: number): void;
  /** Releases all resources; the instance must not be used afterwards. */
  dispose(): void;
}
