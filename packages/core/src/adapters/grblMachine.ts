import type { ConnectableMachine } from '@core/application/machineConnectionService';
import type { Clock } from '@core/application/ports/clock';
import {
  MachineConnectionKind,
  MachineFaultKind,
  MachineStatus,
  type MachineFault,
  type MachineState,
  type MachineStateListener,
  type ProgramRunRequest,
} from '@core/application/ports/machineController';
import type { MachineLink } from '@core/application/ports/machineLink';
import type { GeneratedBlock } from '@core/domain/gcode/generator';
import { formatCoordinate } from '@core/domain/gcode/generator';
import { ORIGIN, type Vector3 } from '@core/domain/geometry/vector3';
import { findLastSegmentUpToLine, type Toolpath } from '@core/domain/toolpath/toolpath';

/** Single-byte commands that Grbl executes immediately, ahead of its input buffer. */
enum GrblRealtimeCommand {
  StatusReport = '?',
  CycleStart = '~',
  FeedHold = '!',
  SoftReset = '\x18',
  JogCancel = '\x85',
  FeedOverrideReset = '\x90',
  FeedOverrideUpTenPercent = '\x91',
  FeedOverrideDownTenPercent = '\x92',
}

/** Machine state names used in Grbl status reports. */
enum GrblReportedState {
  Idle = 'Idle',
  Run = 'Run',
  Hold = 'Hold',
  Jog = 'Jog',
  Alarm = 'Alarm',
  Door = 'Door',
  Check = 'Check',
  Home = 'Home',
  Sleep = 'Sleep',
}

/** What this driver has asked the controller to do. */
enum CommandedActivity {
  None = 'none',
  Jog = 'jog',
  Home = 'home',
  Program = 'program',
}

const STATUS_POLL_INTERVAL_MS = 200;
/** Usable size of Grbl's serial input buffer, in bytes. */
const CONTROLLER_RX_BUFFER_BYTES = 127;
const MIN_FEED_OVERRIDE_PERCENT = 10;
const MAX_FEED_OVERRIDE_PERCENT = 200;
const FEED_OVERRIDE_STEP_PERCENT = 10;

const ERROR_RESPONSE_PREFIX = 'error:';
const ALARM_RESPONSE_PREFIX = 'ALARM:';
const WELCOME_RESPONSE_PREFIX = 'Grbl ';

const parseVector = (text: string): Vector3 | null => {
  const [x, y, z] = text.split(',').map(Number);
  if (x === undefined || y === undefined || z === undefined) return null;
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? { x, y, z } : null;
};

/**
 * Driver for controllers speaking the Grbl 1.1 protocol: Grbl, grblHAL, FluidNC.
 * The channel does not matter: it works the same over a COM port and TCP.
 *
 * Program blocks are streamed with character counting: the next block is sent as soon as it fits
 * into the controller's input buffer, which keeps the planner full and the motion smooth.
 *
 * Status reports are expected in millimeters, the Grbl default (`$13=0`).
 *
 * @see https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface
 */
export class GrblMachine implements ConnectableMachine {
  private state: MachineState = {
    connectionKind: MachineConnectionKind.Hardware,
    status: MachineStatus.Idle,
    position: ORIGIN,
    programProgress: null,
    fault: null,
  };
  private readonly listeners = new Set<MachineStateListener>();
  private readonly stopPolling: () => void;

  private receiveBuffer = '';
  private workCoordinateOffset: Vector3 = ORIGIN;
  private hasResponded = false;
  private isAlarmLatched = false;
  private isSoftResetPending = false;
  private isDisposed = false;
  private activity = CommandedActivity.None;

  private programBlocks: readonly GeneratedBlock[] = [];
  private programToolpath: Toolpath | null = null;
  private nextBlockIndex = 0;
  private acknowledgedProgramBlocks = 0;
  /** Byte lengths of the sent lines the controller has not yet acknowledged, oldest first. */
  private readonly unacknowledgedLineLengths: number[] = [];

  constructor(
    private readonly link: MachineLink,
    private readonly clock: Clock,
  ) {
    link.onData((chunk) => this.handleIncomingChunk(chunk));
    link.onClosed(() => this.handleLinkClosed());
    this.stopPolling = clock.repeat(STATUS_POLL_INTERVAL_MS, () => this.link.write(GrblRealtimeCommand.StatusReport));
  }

  whenResponding(timeoutMs: number): Promise<boolean> {
    const deadline = this.clock.now() + timeoutMs;
    return new Promise((resolve) => {
      const stopWaiting = this.clock.repeat(STATUS_POLL_INTERVAL_MS, () => {
        if (this.hasResponded || this.clock.now() >= deadline) {
          stopWaiting();
          resolve(this.hasResponded);
        }
      });
    });
  }

  getState(): MachineState {
    return this.state;
  }

  subscribe(listener: MachineStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  jogTo(target: Vector3, feedRate: number): void {
    if (this.state.status !== MachineStatus.Idle) return;
    this.activity = CommandedActivity.Jog;
    this.updateState({ status: MachineStatus.Jogging });
    this.sendLine(
      `$J=G90 G21 X${formatCoordinate(target.x)} Y${formatCoordinate(target.y)} Z${formatCoordinate(target.z)} F${formatCoordinate(feedRate)}`,
    );
  }

  goHome(_rapidFeedRate: number): void {
    if (this.state.status !== MachineStatus.Idle) return;
    this.activity = CommandedActivity.Home;
    this.updateState({ status: MachineStatus.Homing });
    this.sendLine('G90 G0 X0 Y0 Z0');
  }

  startProgram(request: ProgramRunRequest): void {
    if (this.state.status !== MachineStatus.Idle || request.blocks.length === 0) return;
    this.activity = CommandedActivity.Program;
    this.programBlocks = request.blocks;
    this.programToolpath = request.toolpath;
    this.nextBlockIndex = 0;
    this.acknowledgedProgramBlocks = 0;
    this.updateState({ status: MachineStatus.RunningProgram, fault: null, programProgress: this.describeProgress() });
    this.streamProgramBlocks();
  }

  pauseProgram(): void {
    if (this.state.status !== MachineStatus.RunningProgram) return;
    this.link.write(GrblRealtimeCommand.FeedHold);
    this.updateState({ status: MachineStatus.ProgramPaused });
  }

  resumeProgram(): void {
    if (this.state.status !== MachineStatus.ProgramPaused) return;
    this.link.write(GrblRealtimeCommand.CycleStart);
    this.updateState({ status: MachineStatus.RunningProgram });
  }

  stop(): void {
    if (this.state.status === MachineStatus.Idle || this.state.status === MachineStatus.Alarm) return;
    if (this.activity === CommandedActivity.Jog) {
      this.link.write(GrblRealtimeCommand.JogCancel);
      return;
    }
    this.abortProgramStreaming();
    // A reset during motion loses the position, so the controller first decelerates to a hold.
    this.link.write(GrblRealtimeCommand.FeedHold);
    this.isSoftResetPending = true;
  }

  emergencyStop(): void {
    if (this.isDisposed) return;
    this.link.write(GrblRealtimeCommand.SoftReset);
    this.latchAlarm(null);
  }

  clearAlarm(): void {
    if (this.state.status !== MachineStatus.Alarm) return;
    this.isAlarmLatched = false;
    this.sendLine('$X');
    this.updateState({ status: MachineStatus.Idle, fault: null });
  }

  setSpeedMultiplier(multiplier: number): void {
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    const percent = Math.min(Math.max(multiplier * 100, MIN_FEED_OVERRIDE_PERCENT), MAX_FEED_OVERRIDE_PERCENT);
    const stepCount = Math.round((percent - 100) / FEED_OVERRIDE_STEP_PERCENT);
    const stepCommand =
      stepCount > 0 ? GrblRealtimeCommand.FeedOverrideUpTenPercent : GrblRealtimeCommand.FeedOverrideDownTenPercent;
    this.link.write(GrblRealtimeCommand.FeedOverrideReset + stepCommand.repeat(Math.abs(stepCount)));
  }

  dispose(): void {
    if (this.isDisposed) return;
    this.isDisposed = true;
    this.stopPolling();
    this.listeners.clear();
    this.link.close();
  }

  private sendLine(line: string): void {
    this.unacknowledgedLineLengths.push(line.length + 1);
    this.link.write(`${line}\n`);
  }

  /** Sends as many blocks as fit into the controller's input buffer. */
  private streamProgramBlocks(): void {
    let bytesInBuffer = this.unacknowledgedLineLengths.reduce((total, length) => total + length, 0);
    while (this.nextBlockIndex < this.programBlocks.length) {
      const block = this.programBlocks[this.nextBlockIndex] as GeneratedBlock;
      const blockBytes = block.text.length + 1;
      if (bytesInBuffer + blockBytes > CONTROLLER_RX_BUFFER_BYTES) return;
      this.sendLine(block.text);
      bytesInBuffer += blockBytes;
      this.nextBlockIndex += 1;
    }
  }

  private abortProgramStreaming(): void {
    this.programBlocks = [];
    this.programToolpath = null;
    this.nextBlockIndex = 0;
    this.acknowledgedProgramBlocks = 0;
    this.updateState({ programProgress: null });
  }

  private handleIncomingChunk(chunk: string): void {
    this.receiveBuffer += chunk;
    let lineEndIndex = this.receiveBuffer.indexOf('\n');
    while (lineEndIndex !== -1) {
      const line = this.receiveBuffer.slice(0, lineEndIndex).trim();
      this.receiveBuffer = this.receiveBuffer.slice(lineEndIndex + 1);
      if (line.length > 0) this.handleResponseLine(line);
      lineEndIndex = this.receiveBuffer.indexOf('\n');
    }
  }

  private handleResponseLine(line: string): void {
    this.hasResponded = true;
    if (line.startsWith('<')) {
      this.handleStatusReport(line);
    } else if (line === 'ok') {
      this.handleAcknowledgement();
    } else if (line.startsWith(ERROR_RESPONSE_PREFIX)) {
      this.handleCommandError(Number(line.slice(ERROR_RESPONSE_PREFIX.length)));
    } else if (line.startsWith(ALARM_RESPONSE_PREFIX)) {
      this.latchAlarm({
        kind: MachineFaultKind.ControllerAlarm,
        controllerCode: Number(line.slice(ALARM_RESPONSE_PREFIX.length)),
      });
    } else if (line.startsWith(WELCOME_RESPONSE_PREFIX)) {
      // The controller has just reset, which discards its input buffer.
      this.unacknowledgedLineLengths.length = 0;
    }
  }

  private handleAcknowledgement(): void {
    this.unacknowledgedLineLengths.shift();
    if (this.activity !== CommandedActivity.Program) return;
    this.acknowledgedProgramBlocks += 1;
    this.streamProgramBlocks();
    this.updateState({ programProgress: this.describeProgress() });
  }

  private handleCommandError(controllerCode: number): void {
    this.unacknowledgedLineLengths.shift();
    const fault: MachineFault = { kind: MachineFaultKind.CommandRejected, controllerCode };
    if (this.activity === CommandedActivity.Program) {
      // Continuing past a rejected block would cut the wrong shape.
      this.abortProgramStreaming();
      this.link.write(GrblRealtimeCommand.FeedHold);
      this.isSoftResetPending = true;
    }
    this.updateState({ fault });
  }

  /** Parses a report such as `<Run|MPos:1.000,2.000,3.000|FS:500,0|WCO:0.000,0.000,0.000>`. */
  private handleStatusReport(report: string): void {
    const [stateField, ...dataFields] = report.slice(1, report.indexOf('>')).split('|');
    let machinePosition: Vector3 | null = null;
    let workPosition: Vector3 | null = null;

    for (const field of dataFields) {
      const separatorIndex = field.indexOf(':');
      const fieldName = field.slice(0, separatorIndex);
      const fieldValue = field.slice(separatorIndex + 1);
      if (fieldName === 'MPos') machinePosition = parseVector(fieldValue);
      else if (fieldName === 'WPos') workPosition = parseVector(fieldValue);
      else if (fieldName === 'WCO') this.workCoordinateOffset = parseVector(fieldValue) ?? this.workCoordinateOffset;
    }

    const position =
      workPosition ??
      (machinePosition && {
        x: machinePosition.x - this.workCoordinateOffset.x,
        y: machinePosition.y - this.workCoordinateOffset.y,
        z: machinePosition.z - this.workCoordinateOffset.z,
      }) ??
      this.state.position;

    // Substates are appended after a colon, for example `Hold:0`.
    const [reportedState, subState] = (stateField ?? '').split(':');
    if (this.isSoftResetPending && (reportedState === GrblReportedState.Idle || (reportedState === GrblReportedState.Hold && subState === '0'))) {
      this.isSoftResetPending = false;
      this.link.write(GrblRealtimeCommand.SoftReset);
      this.unacknowledgedLineLengths.length = 0;
    }

    this.updateState({ position, status: this.resolveStatus(reportedState) });
  }

  /** Combines what the controller reports with what was commanded, whose start it may not have reported yet. */
  private resolveStatus(reportedState: string | undefined): MachineStatus {
    if (this.isAlarmLatched) return MachineStatus.Alarm;

    switch (reportedState) {
      case GrblReportedState.Alarm:
        this.latchAlarm(this.state.fault);
        return MachineStatus.Alarm;
      case GrblReportedState.Hold:
      case GrblReportedState.Door:
        return this.activity === CommandedActivity.Program ? MachineStatus.ProgramPaused : this.state.status;
      case GrblReportedState.Run:
        return this.activity === CommandedActivity.Home ? MachineStatus.Homing : MachineStatus.RunningProgram;
      case GrblReportedState.Jog:
        return MachineStatus.Jogging;
      case GrblReportedState.Home:
        return MachineStatus.Homing;
      case GrblReportedState.Idle:
      case GrblReportedState.Check:
      case GrblReportedState.Sleep:
        return this.resolveStatusOfIdleController();
      default:
        return this.state.status;
    }
  }

  private resolveStatusOfIdleController(): MachineStatus {
    const hasWorkInProgress =
      this.unacknowledgedLineLengths.length > 0 ||
      (this.activity === CommandedActivity.Program && this.nextBlockIndex < this.programBlocks.length);
    if (hasWorkInProgress) return this.state.status;

    if (this.activity === CommandedActivity.Program) this.abortProgramStreaming();
    this.activity = CommandedActivity.None;
    return MachineStatus.Idle;
  }

  private describeProgress(): MachineState['programProgress'] {
    const toolpath = this.programToolpath;
    if (!toolpath) return null;
    const blockInProgress = this.programBlocks[Math.min(this.acknowledgedProgramBlocks, this.programBlocks.length - 1)];
    const sourceLine = blockInProgress?.sourceLine ?? 0;
    return {
      segmentIndex: Math.max(findLastSegmentUpToLine(toolpath, sourceLine), 0),
      segmentCount: toolpath.segmentCount,
      sourceLine,
      completedFraction: this.acknowledgedProgramBlocks / this.programBlocks.length,
    };
  }

  private latchAlarm(fault: MachineFault | null): void {
    this.isAlarmLatched = true;
    this.isSoftResetPending = false;
    this.activity = CommandedActivity.None;
    this.unacknowledgedLineLengths.length = 0;
    this.programBlocks = [];
    this.programToolpath = null;
    this.nextBlockIndex = 0;
    this.updateState({ status: MachineStatus.Alarm, programProgress: null, fault });
  }

  private handleLinkClosed(): void {
    if (this.isDisposed) return;
    this.stopPolling();
    this.latchAlarm({ kind: MachineFaultKind.ConnectionLost, controllerCode: null });
  }

  private updateState(change: Partial<MachineState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
}
