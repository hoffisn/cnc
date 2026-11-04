import { generateGCodeBlocks } from '@core/domain/gcode/generator';
import { hasProgramErrors, type GCodeProgram } from '@core/domain/gcode/program';
import { computeJogDisplacementMm, type JogButtonDraft } from '@core/domain/machine/jogButton';
import {
  findBoundsViolation,
  findPointViolation,
  type MachineSettings,
  type TravelLimitViolation,
} from '@core/domain/machine/machineSettings';
import { err, ok, type Result } from '@core/domain/shared/result';
import type { Toolpath } from '@core/domain/toolpath/toolpath';
import type { ScaleTransform } from '@core/domain/transform/scaleTransform';
import { MachineStatus, type MachineController } from '@core/application/ports/machineController';

/** Reason a command was not sent to the machine. */
export enum CommandRejectionReason {
  MachineBusy = 'machine-busy',
  MachineInAlarm = 'machine-in-alarm',
  OutOfTravelLimits = 'out-of-travel-limits',
  ProgramHasErrors = 'program-has-errors',
  ProgramIsEmpty = 'program-is-empty',
}

/** Rejection caused by the machine's current status. */
export type MachineStateRejection =
  | { readonly reason: CommandRejectionReason.MachineBusy }
  | { readonly reason: CommandRejectionReason.MachineInAlarm };

/** Rejection caused by a target outside the machine's travel. */
export interface TravelLimitRejection {
  readonly reason: CommandRejectionReason.OutOfTravelLimits;
  readonly violation: TravelLimitViolation;
}

/** Why a jog was rejected. */
export type JogRejection = MachineStateRejection | TravelLimitRejection;

/** Why a program run was rejected. */
export type ProgramRunRejection =
  | MachineStateRejection
  | TravelLimitRejection
  | { readonly reason: CommandRejectionReason.ProgramHasErrors }
  | { readonly reason: CommandRejectionReason.ProgramIsEmpty };

/** @returns Why the machine cannot accept a new command, or `null` when it can. */
function findStateRejection(machine: MachineController): MachineStateRejection | null {
  switch (machine.getState().status) {
    case MachineStatus.Idle:
      return null;
    case MachineStatus.Alarm:
      return { reason: CommandRejectionReason.MachineInAlarm };
    case MachineStatus.Jogging:
    case MachineStatus.Homing:
    case MachineStatus.RunningProgram:
    case MachineStatus.ProgramPaused:
      return { reason: CommandRejectionReason.MachineBusy };
  }
}

/** Executes a jog button. The target is checked against travel limits before anything is sent. */
export function jogMachine(
  machine: MachineController,
  button: JogButtonDraft,
  settings: MachineSettings,
): Result<void, JogRejection> {
  const stateRejection = findStateRejection(machine);
  if (stateRejection) return err(stateRejection);

  const { position } = machine.getState();
  const target = {
    ...position,
    [button.axis]: position[button.axis] + computeJogDisplacementMm(button, settings.stepSizeMm),
  };
  const violation = findPointViolation(target, settings.travelLimits);
  if (violation) return err({ reason: CommandRejectionReason.OutOfTravelLimits, violation });

  machine.jogTo(target, button.feedRate);
  return ok(undefined);
}

/** Starts a program. Programs with errors or leaving the machine's travel are never started. */
export function runProgram(
  machine: MachineController,
  program: GCodeProgram,
  toolpath: Toolpath,
  scale: ScaleTransform,
  settings: MachineSettings,
): Result<void, ProgramRunRejection> {
  const stateRejection = findStateRejection(machine);
  if (stateRejection) return err(stateRejection);
  if (hasProgramErrors(program)) return err({ reason: CommandRejectionReason.ProgramHasErrors });
  if (!toolpath.travelBounds) return err({ reason: CommandRejectionReason.ProgramIsEmpty });

  const violation = findBoundsViolation(toolpath.travelBounds, settings.travelLimits);
  if (violation) return err({ reason: CommandRejectionReason.OutOfTravelLimits, violation });

  machine.startProgram({
    toolpath,
    blocks: generateGCodeBlocks(program, scale),
    rapidFeedRate: settings.rapidFeedRate,
    defaultFeedRate: settings.defaultFeedRate,
  });
  return ok(undefined);
}

/** Sends the machine to program zero. */
export function homeMachine(machine: MachineController, settings: MachineSettings): Result<void, MachineStateRejection> {
  const stateRejection = findStateRejection(machine);
  if (stateRejection) return err(stateRejection);
  machine.goHome(settings.rapidFeedRate);
  return ok(undefined);
}
