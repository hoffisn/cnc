import { describe, expect, it } from 'vitest';
import { SimulatedMachine } from '@core/adapters/simulatedMachine';
import { ConnectionFailureReason, MachineConnectionService, type ConnectableMachine } from '@core/application/machineConnectionService';
import type { Clock } from '@core/application/ports/clock';
import { MachineConnectionKind, MachineStatus } from '@core/application/ports/machineController';
import { MachineLinkKind, type MachineLink, type MachineLinkProvider, type MachineLinkTarget } from '@core/application/ports/machineLink';

const SERIAL_TARGET: MachineLinkTarget = { kind: MachineLinkKind.Serial, portPath: 'COM3', baudRate: 115200 };
const idleClock: Clock = { now: () => 0, repeat: () => () => {} };
const unusedLink = {} as MachineLink;

function createHardwareMachine(isResponding: boolean): ConnectableMachine {
  const machine = new SimulatedMachine(idleClock);
  const hardwareState = { ...machine.getState(), connectionKind: MachineConnectionKind.Hardware };
  return Object.assign(machine, {
    getState: () => hardwareState,
    whenResponding: async () => isResponding,
  });
}

function createService(options: { linkError?: string; isResponding?: boolean } = {}) {
  const provider: MachineLinkProvider = {
    listSerialPorts: async () => [],
    open: async () => (options.linkError ? { ok: false, error: options.linkError } : { ok: true, value: unusedLink }),
  };
  return new MachineConnectionService(
    provider,
    () => new SimulatedMachine(idleClock),
    () => createHardwareMachine(options.isResponding ?? true),
  );
}

describe('MachineConnectionService', () => {
  it('starts on the simulator', () => {
    const service = createService();
    expect(service.activeMachine.getState().connectionKind).toBe(MachineConnectionKind.Simulator);
    expect(service.activeTarget).toBeNull();
  });

  it('switches to hardware after it answers and notifies listeners', async () => {
    const service = createService();
    const seenKinds: MachineConnectionKind[] = [];
    service.subscribe((state) => seenKinds.push(state.connectionKind));

    expect((await service.connect(SERIAL_TARGET)).ok).toBe(true);
    expect(service.activeTarget).toEqual(SERIAL_TARGET);
    expect(seenKinds).toEqual([MachineConnectionKind.Hardware]);
  });

  it('reports the system message when the port cannot be opened', async () => {
    const service = createService({ linkError: 'Access denied' });
    expect(await service.connect(SERIAL_TARGET)).toEqual({
      ok: false,
      error: { reason: ConnectionFailureReason.LinkFailed, systemMessage: 'Access denied' },
    });
    expect(service.activeTarget).toBeNull();
  });

  it('stays on the current machine when the controller does not answer', async () => {
    const service = createService({ isResponding: false });
    const simulator = service.activeMachine;
    const result = await service.connect(SERIAL_TARGET);
    expect(result).toMatchObject({ ok: false, error: { reason: ConnectionFailureReason.ControllerNotResponding } });
    expect(service.activeMachine).toBe(simulator);
  });

  it('refuses to switch while the machine is moving', async () => {
    const service = createService();
    service.activeMachine.jogTo({ x: 100, y: 0, z: 0 }, 100);
    expect(service.activeMachine.getState().status).toBe(MachineStatus.Jogging);
    expect(await service.connect(SERIAL_TARGET)).toMatchObject({
      ok: false,
      error: { reason: ConnectionFailureReason.MachineBusy },
    });
    expect(service.disconnect()).toMatchObject({ ok: false, error: { reason: ConnectionFailureReason.MachineBusy } });
  });
});
