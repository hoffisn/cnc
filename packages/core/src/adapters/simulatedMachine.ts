import type { Clock } from '@core/application/ports/clock';
import {
  MachineConnectionKind,
  MachineStatus,
  type MachineController,
  type MachineState,
  type MachineStateListener,
  type ProgramRunProgress,
  type ProgramRunRequest,
} from '@core/application/ports/machineController';
import { ORIGIN, distanceBetween, interpolate, type Vector3 } from '@core/domain/geometry/vector3';
import { COORDINATES_PER_SEGMENT, SegmentKind } from '@core/domain/toolpath/toolpath';


/** About 30 updates per second: smooth for the eye and cheap for the UI. */
const SIMULATION_TICK_MS = 33;
const MILLISECONDS_PER_MINUTE = 60000;

/** Single straight movement of the simulated tool. */
interface SimulatedMove {
  readonly start: Vector3;
  readonly end: Vector3;
  readonly feedRate: number;
  readonly length: number;
}

/** Sequence of movements the machine works through. */
interface MotionPlan {
  /** @returns The next movement, or `null` when the plan is finished. */
  takeNextMove(): SimulatedMove | null;
  /** @returns Progress to report, or `null` for plans other than program runs. */
  describeProgress(traveledLength: number): ProgramRunProgress | null;
}

const createMove = (start: Vector3, end: Vector3, feedRate: number): SimulatedMove => ({
  start,
  end,
  feedRate,
  length: distanceBetween(start, end),
});

function createSingleMovePlan(start: Vector3, end: Vector3, feedRate: number): MotionPlan {
  let isTaken = false;
  return {
    takeNextMove() {
      if (isTaken) return null;
      isTaken = true;
      return createMove(start, end, feedRate);
    },
    describeProgress: () => null,
  };
}

function createProgramPlan(request: ProgramRunRequest, machinePosition: Vector3): MotionPlan {
  const { toolpath, rapidFeedRate, defaultFeedRate } = request;
  const { segmentCoordinates: coordinates, segmentCount } = toolpath;
  const pathLength = toolpath.feedLength + toolpath.rapidLength;
  const programStart: Vector3 = { x: coordinates[0] ?? 0, y: coordinates[1] ?? 0, z: coordinates[2] ?? 0 };

  // The machine may be anywhere, so it first approaches the program's start at rapid speed.
  let needsApproach = distanceBetween(machinePosition, programStart) > 0;
  let nextSegmentIndex = 0;
  let currentSegmentIndex = 0;

  return {
    takeNextMove() {
      if (needsApproach) {
        needsApproach = false;
        return createMove(machinePosition, programStart, rapidFeedRate);
      }
      if (nextSegmentIndex >= segmentCount) return null;

      const offset = nextSegmentIndex * COORDINATES_PER_SEGMENT;
      const programmedFeedRate = toolpath.segmentFeedRates[nextSegmentIndex] as number;
      const feedRate =
        toolpath.segmentKinds[nextSegmentIndex] === SegmentKind.Rapid
          ? rapidFeedRate
          : programmedFeedRate > 0
            ? programmedFeedRate
            : defaultFeedRate;

      currentSegmentIndex = nextSegmentIndex;
      nextSegmentIndex += 1;
      return createMove(
        { x: coordinates[offset] as number, y: coordinates[offset + 1] as number, z: coordinates[offset + 2] as number },
        { x: coordinates[offset + 3] as number, y: coordinates[offset + 4] as number, z: coordinates[offset + 5] as number },
        feedRate,
      );
    },
    describeProgress(traveledLength) {
      return {
        segmentIndex: currentSegmentIndex,
        segmentCount,
        sourceLine: toolpath.segmentSourceLines[currentSegmentIndex] ?? 0,
        completedFraction: pathLength > 0 ? Math.min(traveledLength / pathLength, 1) : 1,
      };
    },
  };
}

/**
 * Machine simulator: moves at the commanded speeds in real time without talking to any hardware.
 * Enables development and demonstrations before a controller is connected.
 */
export class SimulatedMachine implements MachineController {
  private state: MachineState = {
    connectionKind: MachineConnectionKind.Simulator,
    status: MachineStatus.Idle,
    position: ORIGIN,
    programProgress: null,
    fault: null,
  };
  private readonly listeners = new Set<MachineStateListener>();
  private motionPlan: MotionPlan | null = null;
  private currentMove: SimulatedMove | null = null;
  private currentMoveTraveled = 0;
  private planTraveled = 0;
  private speedMultiplier = 1;
  private lastTickTime = 0;
  private stopTicking: (() => void) | null = null;

  constructor(private readonly clock: Clock) {}

  getState(): MachineState {
    return this.state;
  }

  subscribe(listener: MachineStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setSpeedMultiplier(multiplier: number): void {
    if (Number.isFinite(multiplier) && multiplier > 0) this.speedMultiplier = multiplier;
  }

  jogTo(target: Vector3, feedRate: number): void {
    if (this.state.status !== MachineStatus.Idle) return;
    this.beginPlan(MachineStatus.Jogging, createSingleMovePlan(this.state.position, target, feedRate));
  }

  goHome(rapidFeedRate: number): void {
    if (this.state.status !== MachineStatus.Idle) return;
    this.beginPlan(MachineStatus.Homing, createSingleMovePlan(this.state.position, ORIGIN, rapidFeedRate));
  }

  startProgram(request: ProgramRunRequest): void {
    if (this.state.status !== MachineStatus.Idle || request.toolpath.segmentCount === 0) return;
    this.beginPlan(MachineStatus.RunningProgram, createProgramPlan(request, this.state.position));
  }

  pauseProgram(): void {
    if (this.state.status !== MachineStatus.RunningProgram) return;
    this.haltTicking();
    this.updateState({ status: MachineStatus.ProgramPaused });
  }

  resumeProgram(): void {
    if (this.state.status !== MachineStatus.ProgramPaused) return;
    this.updateState({ status: MachineStatus.RunningProgram });
    this.startTicking();
  }

  stop(): void {
    if (this.state.status === MachineStatus.Idle || this.state.status === MachineStatus.Alarm) return;
    this.finishPlan(MachineStatus.Idle);
  }

  emergencyStop(): void {
    if (this.state.status !== MachineStatus.Alarm) this.finishPlan(MachineStatus.Alarm);
  }

  clearAlarm(): void {
    if (this.state.status === MachineStatus.Alarm) this.updateState({ status: MachineStatus.Idle });
  }

  dispose(): void {
    this.haltTicking();
    this.listeners.clear();
  }

  private beginPlan(status: MachineStatus, plan: MotionPlan): void {
    this.motionPlan = plan;
    this.currentMove = null;
    this.currentMoveTraveled = 0;
    this.planTraveled = 0;
    this.updateState({ status, programProgress: plan.describeProgress(0) });
    this.startTicking();
  }

  private startTicking(): void {
    this.lastTickTime = this.clock.now();
    this.stopTicking = this.clock.repeat(SIMULATION_TICK_MS, () => this.advanceSimulation());
  }

  private haltTicking(): void {
    this.stopTicking?.();
    this.stopTicking = null;
  }

  private finishPlan(status: MachineStatus): void {
    this.haltTicking();
    this.motionPlan = null;
    this.currentMove = null;
    this.updateState({ status, programProgress: null });
  }

  /** Spends the time elapsed since the last tick on movement, across as many moves as it covers. */
  private advanceSimulation(): void {
    const plan = this.motionPlan;
    if (!plan) return;

    const now = this.clock.now();
    let remainingTimeMs = now - this.lastTickTime;
    this.lastTickTime = now;
    let position = this.state.position;

    while (remainingTimeMs > 0) {
      if (!this.currentMove) {
        this.currentMove = plan.takeNextMove();
        this.currentMoveTraveled = 0;
        if (!this.currentMove) {
          this.updateState({ position });
          this.finishPlan(MachineStatus.Idle);
          return;
        }
      }

      const move = this.currentMove;
      const speedMmPerMs = (move.feedRate / MILLISECONDS_PER_MINUTE) * this.speedMultiplier;
      const remainingLength = move.length - this.currentMoveTraveled;
      const reachableLength = speedMmPerMs * remainingTimeMs;

      if (reachableLength >= remainingLength) {
        remainingTimeMs -= remainingLength / speedMmPerMs;
        this.planTraveled += remainingLength;
        position = move.end;
        this.currentMove = null;
      } else {
        this.currentMoveTraveled += reachableLength;
        this.planTraveled += reachableLength;
        position = interpolate(move.start, move.end, this.currentMoveTraveled / move.length);
        remainingTimeMs = 0;
      }
    }

    this.updateState({ position, programProgress: plan.describeProgress(this.planTraveled) });
  }

  private updateState(change: Partial<MachineState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
}
