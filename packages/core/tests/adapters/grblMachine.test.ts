import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '@core/application/ports/clock';
import { MachineFaultKind, MachineStatus, type ProgramRunRequest } from '@core/application/ports/machineController';
import type { MachineLink } from '@core/application/ports/machineLink';
import { generateGCodeBlocks } from '@core/domain/gcode/generator';
import { parseGCode } from '@core/domain/gcode/parser';
import { buildToolpath } from '@core/domain/toolpath/toolpath';
import { IDENTITY_SCALE } from '@core/domain/transform/scaleTransform';
import { GrblMachine } from '@core/adapters/grblMachine';

/** Records what the driver writes and replays what a controller would answer. */
class ScriptedLink implements MachineLink {
  written: string[] = [];
  isClosed = false;
  private dataListener: (chunk: string) => void = () => {};
  private closedListener: () => void = () => {};

  write(data: string): void {
    this.written.push(data);
  }
  onData(listener: (chunk: string) => void): void {
    this.dataListener = listener;
  }
  onClosed(listener: () => void): void {
    this.closedListener = listener;
  }
  close(): void {
    this.isClosed = true;
  }
  receive(chunk: string): void {
    this.dataListener(chunk);
  }
  dropConnection(): void {
    this.closedListener();
  }
  takeWritten(): string[] {
    const written = this.written;
    this.written = [];
    return written;
  }
}

class ManualClock implements Clock {
  currentTime = 0;
  private readonly callbacks = new Set<() => void>();

  now(): number {
    return this.currentTime;
  }
  repeat(_intervalMs: number, callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }
  advance(durationMs: number): void {
    this.currentTime += durationMs;
    for (const callback of [...this.callbacks]) callback();
  }
}

function createRunRequest(source: string): ProgramRunRequest {
  const program = parseGCode(source);
  return {
    toolpath: buildToolpath(program, IDENTITY_SCALE, 0.01),
    blocks: generateGCodeBlocks(program, IDENTITY_SCALE),
    rapidFeedRate: 1000,
    defaultFeedRate: 1000,
  };
}

describe('GrblMachine', () => {
  let link: ScriptedLink;
  let clock: ManualClock;
  let machine: GrblMachine;

  beforeEach(() => {
    link = new ScriptedLink();
    clock = new ManualClock();
    machine = new GrblMachine(link, clock);
  });

  it('polls the status and reads the work position from a report split across chunks', () => {
    clock.advance(200);
    expect(link.written).toContain('?');
    link.receive('<Idle|WPos:1.000,2.');
    link.receive('500,-3.000|FS:0,0>\r\n');
    expect(machine.getState().position).toEqual({ x: 1, y: 2.5, z: -3 });
  });

  it('derives the work position from MPos and the remembered offset', () => {
    link.receive('<Idle|MPos:10.000,10.000,10.000|WCO:1.000,2.000,3.000>\n');
    link.receive('<Idle|MPos:11.000,10.000,10.000>\n');
    expect(machine.getState().position).toEqual({ x: 10, y: 8, z: 7 });
  });

  it('sends a jog in the Grbl jog format and is idle only after it finishes', () => {
    machine.jogTo({ x: 1.5, y: 0, z: -2 }, 500);
    expect(link.takeWritten()).toEqual(['$J=G90 G21 X1.5 Y0 Z-2 F500\n']);
    expect(machine.getState().status).toBe(MachineStatus.Jogging);

    link.receive('<Idle|WPos:0,0,0>\n');
    expect(machine.getState().status).toBe(MachineStatus.Jogging);

    link.receive('ok\n<Jog|WPos:1,0,0>\n');
    expect(machine.getState().status).toBe(MachineStatus.Jogging);

    link.receive('<Idle|WPos:1.5,0,-2>\n');
    expect(machine.getState().status).toBe(MachineStatus.Idle);
  });

  it('never overfills the controller input buffer while streaming', () => {
    const programLines = Array.from({ length: 40 }, (_, index) => `G1 X${index + 1} Y${index + 1} Z${index + 1} F100`);
    machine.startProgram(createRunRequest(programLines.join('\n')));

    const bytesSent = () => link.written.reduce((total, line) => total + line.length, 0);
    const firstBurst = bytesSent();
    expect(firstBurst).toBeLessThanOrEqual(127);
    expect(firstBurst).toBeGreaterThan(50);

    link.takeWritten();
    link.receive('ok\n');
    expect(link.written.length).toBeGreaterThan(0);
    expect(link.written.join('').length).toBeLessThanOrEqual(firstBurst);
  });

  it('runs a program to the end, reporting progress by source line', () => {
    machine.startProgram(createRunRequest('G1 X10 F100\nG1 Y10\nM30'));
    expect(link.written.join('')).toContain('G1 X10 Y0 Z0 F100\nG1 Y10\nM30\n');
    expect(machine.getState().status).toBe(MachineStatus.RunningProgram);

    link.receive('ok\nok\nok\n');
    expect(machine.getState().programProgress?.sourceLine).toBe(2);
    link.receive('ok\nok\n<Run|WPos:10,5,0>\n');
    expect(machine.getState().status).toBe(MachineStatus.RunningProgram);

    link.receive('<Idle|WPos:10,10,0>\n');
    expect(machine.getState()).toMatchObject({ status: MachineStatus.Idle, programProgress: null });
  });

  it('stays running while blocks remain even if the controller reports idle between them', () => {
    const programLines = Array.from({ length: 40 }, (_, index) => `G1 X${index + 1} Y${index + 1} Z${index + 1} F100`);
    machine.startProgram(createRunRequest(programLines.join('\n')));
    link.receive('<Idle|WPos:0,0,0>\n');
    expect(machine.getState().status).toBe(MachineStatus.RunningProgram);
  });

  it('pauses with a feed hold and resumes with a cycle start', () => {
    machine.startProgram(createRunRequest('G1 X10 F100'));
    link.takeWritten();
    machine.pauseProgram();
    machine.resumeProgram();
    expect(link.takeWritten()).toEqual(['!', '~']);
  });

  it('stops a program by decelerating first and resetting only once on hold', () => {
    machine.startProgram(createRunRequest('G1 X10 F100'));
    link.takeWritten();
    machine.stop();
    expect(link.takeWritten()).toEqual(['!']);

    link.receive('<Hold:1|WPos:3,0,0>\n');
    expect(link.written).toEqual([]);

    link.receive('<Hold:0|WPos:4,0,0>\n');
    expect(link.takeWritten()).toEqual(['\x18']);

    link.receive("Grbl 1.1h ['$' for help]\n<Idle|WPos:4,0,0>\n");
    expect(machine.getState()).toMatchObject({ status: MachineStatus.Idle, programProgress: null });
  });

  it('cancels a jog with the dedicated realtime command', () => {
    machine.jogTo({ x: 100, y: 0, z: 0 }, 500);
    link.takeWritten();
    machine.stop();
    expect(link.takeWritten()).toEqual(['\x85']);
  });

  it('aborts a program when the controller rejects a block', () => {
    machine.startProgram(createRunRequest('G1 X10 F100\nG1 Y10'));
    link.takeWritten();
    link.receive('error:20\n');
    expect(link.takeWritten()).toEqual(['!']);
    expect(machine.getState()).toMatchObject({
      programProgress: null,
      fault: { kind: MachineFaultKind.CommandRejected, controllerCode: 20 },
    });
  });

  it('latches an alarm reported by the controller until the operator clears it', () => {
    link.receive('ALARM:1\n');
    expect(machine.getState()).toMatchObject({
      status: MachineStatus.Alarm,
      fault: { kind: MachineFaultKind.ControllerAlarm, controllerCode: 1 },
    });

    link.receive('<Idle|WPos:0,0,0>\n');
    expect(machine.getState().status).toBe(MachineStatus.Alarm);

    machine.jogTo({ x: 1, y: 0, z: 0 }, 100);
    expect(link.written.join('')).not.toContain('$J');

    machine.clearAlarm();
    expect(link.written.join('')).toContain('$X\n');
    expect(machine.getState()).toMatchObject({ status: MachineStatus.Idle, fault: null });
  });

  it('resets immediately on emergency stop and locks itself', () => {
    machine.startProgram(createRunRequest('G1 X10 F100'));
    link.takeWritten();
    machine.emergencyStop();
    expect(link.takeWritten()).toEqual(['\x18']);
    expect(machine.getState()).toMatchObject({ status: MachineStatus.Alarm, programProgress: null });
  });

  it('turns a lost connection into an alarm', () => {
    machine.startProgram(createRunRequest('G1 X10 F100'));
    link.dropConnection();
    expect(machine.getState()).toMatchObject({
      status: MachineStatus.Alarm,
      fault: { kind: MachineFaultKind.ConnectionLost },
    });
  });

  it('expresses the speed multiplier as feed override steps within the supported range', () => {
    machine.setSpeedMultiplier(1.3);
    expect(link.takeWritten()).toEqual(['\x90\x91\x91\x91']);
    machine.setSpeedMultiplier(20);
    expect(link.takeWritten()).toEqual([`\x90${'\x91'.repeat(10)}`]);
    machine.setSpeedMultiplier(0.5);
    expect(link.takeWritten()).toEqual([`\x90${'\x92'.repeat(5)}`]);
  });

  it('confirms the controller responds, or gives up at the deadline', async () => {
    const responding = machine.whenResponding(1000);
    link.receive("Grbl 1.1h ['$' for help]\n");
    clock.advance(200);
    await expect(responding).resolves.toBe(true);

    const silentMachine = new GrblMachine(new ScriptedLink(), clock);
    const silent = silentMachine.whenResponding(1000);
    clock.advance(1000);
    await expect(silent).resolves.toBe(false);
  });
});
