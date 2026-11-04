import { beforeEach, describe, expect, it } from 'vitest';
import { SimulatedMachine } from '@core/adapters/simulatedMachine';
import { Axis } from '@core/domain/geometry/vector3';
import { parseGCode } from '@core/domain/gcode/parser';
import { JogDirection, JogUnit, type JogButtonDraft } from '@core/domain/machine/jogButton';
import { DEFAULT_MACHINE_SETTINGS } from '@core/domain/machine/machineSettings';
import type { AppSettings } from '@core/domain/settings/appSettings';
import { buildToolpath } from '@core/domain/toolpath/toolpath';
import { IDENTITY_SCALE } from '@core/domain/transform/scaleTransform';
import { CommandRejectionReason, homeMachine, jogMachine, runProgram } from '@core/application/machineUseCases';
import type { Clock } from '@core/application/ports/clock';
import { MachineStatus } from '@core/application/ports/machineController';
import { OpenProgramStatus, SaveProgramStatus, type ProgramFileGateway } from '@core/application/ports/programFileGateway';
import { exportProgram, suggestExportFileName } from '@core/application/programUseCases';
import { SettingsLoadStatus, SettingsService } from '@core/application/settingsService';

/** Clock advanced by hand, which makes the simulation fully deterministic. */
class ManualClock implements Clock {
  currentTime = 0;
  tickCallback: (() => void) | null = null;

  now(): number {
    return this.currentTime;
  }

  repeat(_intervalMs: number, callback: () => void): () => void {
    this.tickCallback = callback;
    return () => {
      if (this.tickCallback === callback) this.tickCallback = null;
    };
  }

  advance(durationMs: number): void {
    this.currentTime += durationMs;
    this.tickCallback?.();
  }
}

const CHORD_TOLERANCE = 0.01;
const settings = DEFAULT_MACHINE_SETTINGS;
const forward100Mm: JogButtonDraft = {
  label: 'Forward',
  axis: Axis.Y,
  direction: JogDirection.Positive,
  distance: 100,
  unit: JogUnit.Millimeter,
  feedRate: 6000,
};

describe('machine use cases on the simulator', () => {
  let clock: ManualClock;
  let machine: SimulatedMachine;

  beforeEach(() => {
    clock = new ManualClock();
    machine = new SimulatedMachine(clock);
  });

  const prepareProgram = (source: string) => {
    const program = parseGCode(source);
    return { program, toolpath: buildToolpath(program, IDENTITY_SCALE, CHORD_TOLERANCE) };
  };

  it('jogs at the commanded feed rate and stops exactly at the target', () => {
    expect(jogMachine(machine, forward100Mm, settings).ok).toBe(true);
    expect(machine.getState().status).toBe(MachineStatus.Jogging);
    clock.advance(500); // 6000 mm/min is 100 mm/s
    expect(machine.getState().position.y).toBeCloseTo(50);
    clock.advance(600);
    expect(machine.getState()).toMatchObject({ status: MachineStatus.Idle, position: { x: 0, y: 100, z: 0 } });
    expect(clock.tickCallback).toBeNull();
  });

  it('speeds up with the speed multiplier', () => {
    machine.setSpeedMultiplier(10);
    jogMachine(machine, forward100Mm, settings);
    clock.advance(50);
    expect(machine.getState().position.y).toBeCloseTo(50);
  });

  it('never sends a jog beyond the travel limits', () => {
    const result = jogMachine(machine, { ...forward100Mm, distance: 1000, unit: JogUnit.Meter }, settings);
    expect(result).toMatchObject({
      ok: false,
      error: { reason: CommandRejectionReason.OutOfTravelLimits, violation: { axis: Axis.Y } },
    });
    expect(machine.getState().status).toBe(MachineStatus.Idle);
  });

  it('refuses commands while busy', () => {
    const busy = { ok: false, error: { reason: CommandRejectionReason.MachineBusy } };
    jogMachine(machine, forward100Mm, settings);
    expect(jogMachine(machine, forward100Mm, settings)).toEqual(busy);
    expect(homeMachine(machine, settings)).toEqual(busy);
  });

  it('halts on emergency stop and stays locked until the alarm is cleared', () => {
    const inAlarm = { ok: false, error: { reason: CommandRejectionReason.MachineInAlarm } };
    jogMachine(machine, forward100Mm, settings);
    clock.advance(100);
    machine.emergencyStop();
    const haltedAtY = machine.getState().position.y;
    clock.advance(1000);
    expect(machine.getState()).toMatchObject({ status: MachineStatus.Alarm, position: { y: haltedAtY } });
    expect(jogMachine(machine, forward100Mm, settings)).toEqual(inAlarm);
    const { program, toolpath } = prepareProgram('G0 X1');
    expect(runProgram(machine, program, toolpath, IDENTITY_SCALE, settings)).toEqual(inAlarm);
    expect(homeMachine(machine, settings)).toEqual(inAlarm);
    machine.clearAlarm();
    expect(jogMachine(machine, forward100Mm, settings).ok).toBe(true);
  });

  it('returns home to zero', () => {
    jogMachine(machine, forward100Mm, settings);
    clock.advance(2000);
    homeMachine(machine, settings);
    clock.advance(60000);
    expect(machine.getState()).toMatchObject({ status: MachineStatus.Idle, position: { x: 0, y: 0, z: 0 } });
  });

  it('runs a program to the end, reporting progress and the source line', () => {
    const { program, toolpath } = prepareProgram('G1 X100 F6000\nG1 Y100\nM30');
    expect(runProgram(machine, program, toolpath, IDENTITY_SCALE, settings).ok).toBe(true);
    clock.advance(500);
    expect(machine.getState().programProgress).toMatchObject({ sourceLine: 1, completedFraction: 0.25 });
    clock.advance(1000);
    expect(machine.getState().programProgress).toMatchObject({ sourceLine: 2, completedFraction: 0.75 });
    clock.advance(1000);
    expect(machine.getState()).toMatchObject({
      status: MachineStatus.Idle,
      programProgress: null,
      position: { x: 100, y: 100, z: 0 },
    });
  });

  it('covers many segments in one long tick without losing time', () => {
    const { program, toolpath } = prepareProgram('G1 X10 F6000\nG1 X20\nG1 X30\nG1 X40');
    runProgram(machine, program, toolpath, IDENTITY_SCALE, settings);
    clock.advance(250);
    expect(machine.getState().position.x).toBeCloseTo(25);
  });

  it('freezes on pause and continues from the same place without counting the paused time', () => {
    const { program, toolpath } = prepareProgram('G1 X100 F6000');
    runProgram(machine, program, toolpath, IDENTITY_SCALE, settings);
    clock.advance(200);
    machine.pauseProgram();
    clock.advance(5000);
    expect(machine.getState()).toMatchObject({ status: MachineStatus.ProgramPaused, position: { x: 20 } });
    machine.resumeProgram();
    clock.advance(100);
    expect(machine.getState().position.x).toBeCloseTo(30);
  });

  it('ends a program without an alarm on a regular stop', () => {
    const { program, toolpath } = prepareProgram('G1 X100 F6000');
    runProgram(machine, program, toolpath, IDENTITY_SCALE, settings);
    clock.advance(100);
    machine.stop();
    expect(machine.getState()).toMatchObject({ status: MachineStatus.Idle, programProgress: null });
    expect(machine.getState().position.x).toBeCloseTo(10);
  });

  it('approaches the program start first when standing elsewhere', () => {
    jogMachine(machine, forward100Mm, settings);
    clock.advance(2000);
    const { program, toolpath } = prepareProgram('G1 X10 F6000');
    runProgram(machine, program, toolpath, IDENTITY_SCALE, settings);
    clock.advance(60000);
    expect(machine.getState().position).toEqual({ x: 10, y: 0, z: 0 });
  });

  it('falls back to the default feed rate when the program sets none', () => {
    const { program, toolpath } = prepareProgram('G1 X100');
    runProgram(machine, program, toolpath, IDENTITY_SCALE, { ...settings, defaultFeedRate: 6000 });
    clock.advance(500);
    expect(machine.getState().position.x).toBeCloseTo(50);
  });

  it('refuses programs with errors, without motion, or beyond the travel limits', () => {
    const broken = prepareProgram('G1 X F100');
    expect(runProgram(machine, broken.program, broken.toolpath, IDENTITY_SCALE, settings)).toEqual({
      ok: false,
      error: { reason: CommandRejectionReason.ProgramHasErrors },
    });
    const empty = prepareProgram('; nothing');
    expect(runProgram(machine, empty.program, empty.toolpath, IDENTITY_SCALE, settings)).toEqual({
      ok: false,
      error: { reason: CommandRejectionReason.ProgramIsEmpty },
    });
    const distant = prepareProgram('G0 X99999');
    expect(runProgram(machine, distant.program, distant.toolpath, IDENTITY_SCALE, settings)).toMatchObject({
      ok: false,
      error: { reason: CommandRejectionReason.OutOfTravelLimits },
    });
    expect(machine.getState().status).toBe(MachineStatus.Idle);
  });

  it('checks travel limits against the scaled figure', () => {
    const program = parseGCode('G1 X5000 F100');
    const stretch = { x: 3, y: 1, z: 1 };
    const stretchedPath = buildToolpath(program, stretch, CHORD_TOLERANCE);
    expect(runProgram(machine, program, stretchedPath, stretch, settings)).toMatchObject({
      ok: false,
      error: { reason: CommandRejectionReason.OutOfTravelLimits },
    });
  });

  it('stops notifying a listener after it unsubscribes', () => {
    let notificationCount = 0;
    const unsubscribe = machine.subscribe(() => (notificationCount += 1));
    jogMachine(machine, forward100Mm, settings);
    const countBeforeUnsubscribing = notificationCount;
    unsubscribe();
    clock.advance(100);
    expect(notificationCount).toBe(countBeforeUnsubscribing);
    expect(countBeforeUnsubscribing).toBeGreaterThan(0);
  });
});

describe('SettingsService', () => {
  const createService = (storedValue: unknown = null) => {
    const savedSnapshots: AppSettings[] = [];
    let generatedIdCount = 0;
    const service = new SettingsService(
      {
        load: async () => storedValue,
        save: async (settingsToSave) => {
          savedSnapshots.push(settingsToSave);
        },
      },
      () => `generated-${(generatedIdCount += 1)}`,
    );
    return { service, savedSnapshots };
  };

  it('adds, edits, moves and removes buttons, persisting each change', async () => {
    const { service, savedSnapshots } = createService({ jogButtons: [], machine: DEFAULT_MACHINE_SETTINGS });
    await service.load();
    const buttonIds = () => service.current.jogButtons.map((button) => button.id);

    service.saveJogButton(forward100Mm, null);
    service.saveJogButton({ ...forward100Mm, label: 'Second' }, null);
    expect(buttonIds()).toEqual(['generated-1', 'generated-2']);

    service.saveJogButton({ ...forward100Mm, label: 'Renamed' }, 'generated-1');
    expect(service.current.jogButtons[0]?.label).toBe('Renamed');
    expect(buttonIds()).toHaveLength(2);

    service.moveJogButton('generated-2', -1);
    expect(buttonIds()).toEqual(['generated-2', 'generated-1']);
    service.moveJogButton('generated-2', -1);
    expect(buttonIds()).toEqual(['generated-2', 'generated-1']);

    service.removeJogButton('generated-2');
    expect(buttonIds()).toEqual(['generated-1']);

    await service.whenPersisted();
    expect(savedSnapshots).toHaveLength(5);
    expect(savedSnapshots.at(-1)).toEqual(service.current);
  });

  it('adds a new button when the id to replace is unknown', () => {
    const { service } = createService();
    const result = service.saveJogButton(forward100Mm, 'no-such-id');
    expect(result).toMatchObject({ ok: true, value: { id: 'generated-1' } });
  });

  it('does not persist an invalid button', () => {
    const { service, savedSnapshots } = createService();
    expect(service.saveJogButton({ ...forward100Mm, distance: -1 }, null).ok).toBe(false);
    expect(savedSnapshots).toHaveLength(0);
  });

  it('reports a write failure and keeps working', async () => {
    const failures: unknown[] = [];
    const service = new SettingsService(
      { load: async () => null, save: () => Promise.reject(new Error('disk failure')) },
      () => 'unused-id',
    );
    service.onPersistFailure((cause) => failures.push(cause));
    service.resetJogButtons();
    await service.whenPersisted();
    expect(failures).toHaveLength(1);
  });

  it('reports each load outcome', async () => {
    const failing = new SettingsService(
      { load: () => Promise.reject(new Error('disk failure')), save: async () => {} },
      () => 'unused-id',
    );
    expect(await failing.load()).toBe(SettingsLoadStatus.Failed);
    expect(failing.current.jogButtons.length).toBeGreaterThan(0);
    expect(await createService().service.load()).toBe(SettingsLoadStatus.Loaded);
    expect(await createService('damaged').service.load()).toBe(SettingsLoadStatus.Recovered);
  });
});

describe('program export', () => {
  it('suggests a name that cannot overwrite the original when scaled', () => {
    expect(suggestExportFileName('part.nc', IDENTITY_SCALE)).toBe('part.nc');
    expect(suggestExportFileName('part.nc', { x: 2, y: 1, z: 1 })).toBe('part_scaled.nc');
    expect(suggestExportFileName('noextension', { x: 2, y: 1, z: 1 })).toBe('noextension_scaled.nc');
    expect(suggestExportFileName(null, IDENTITY_SCALE)).toBe('program.nc');
  });

  it('saves scaled G-code and refuses programs with errors', async () => {
    let savedText = '';
    const gateway: ProgramFileGateway = {
      open: async () => ({ status: OpenProgramStatus.Cancelled, isRemovableDriveMissing: false }),
      save: async (fileName, text) => {
        savedText = text;
        return { status: SaveProgramStatus.Saved, fileName };
      },
    };

    const saved = await exportProgram(gateway, parseGCode('G1 X10 F100'), { x: 2, y: 1, z: 1 }, 'part.nc');
    expect(saved).toEqual({ ok: true, value: { status: SaveProgramStatus.Saved, fileName: 'part_scaled.nc' } });
    expect(savedText).toContain('X20');

    savedText = '';
    const refused = await exportProgram(gateway, parseGCode('G1 X'), IDENTITY_SCALE, 'part.nc');
    expect(refused).toEqual({ ok: false, error: { reason: CommandRejectionReason.ProgramHasErrors } });
    expect(savedText).toBe('');
  });
});
