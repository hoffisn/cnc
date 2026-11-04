import { err, ok, type Result } from '@core/domain/shared/result';
import {
  MachineStatus,
  type MachineController,
  type MachineState,
  type MachineStateListener,
} from '@core/application/ports/machineController';
import type { MachineLink, MachineLinkProvider, MachineLinkTarget, SerialPortInfo } from '@core/application/ports/machineLink';

/** Hardware driver that can confirm a controller actually answers on an open channel. */
export interface ConnectableMachine extends MachineController {
  /** @returns Whether the controller responded within the time limit. */
  whenResponding(timeoutMs: number): Promise<boolean>;
}

/** Reason a connection attempt failed. */
export enum ConnectionFailureReason {
  /** Switching machines mid-motion would lose control over the running one. */
  MachineBusy = 'machine-busy',
  /** The port is missing, taken by another program, or the host is unreachable. */
  LinkFailed = 'link-failed',
  /** The channel opened, but nothing speaking the protocol answered. */
  ControllerNotResponding = 'controller-not-responding',
}

/** Details of a failed connection attempt. */
export interface ConnectionFailure {
  readonly reason: ConnectionFailureReason;
  /** The operating system's explanation, when there is one. */
  readonly systemMessage: string | null;
}

const CONTROLLER_RESPONSE_TIMEOUT_MS = 5000;

/**
 * Owns the active machine and switches it between the simulator and real hardware.
 * The rest of the application talks to whichever machine is active and survives the switch,
 * because listeners stay subscribed through this service.
 */
export class MachineConnectionService {
  private machine: MachineController;
  private target: MachineLinkTarget | null = null;
  private unsubscribeFromMachine: () => void;
  private readonly listeners = new Set<MachineStateListener>();

  /**
   * @param linkProvider - Opens channels to controllers.
   * @param createSimulator - Creates the machine used while no hardware is connected.
   * @param createHardwareMachine - Creates the driver for an open channel.
   */
  constructor(
    private readonly linkProvider: MachineLinkProvider,
    private readonly createSimulator: () => MachineController,
    private readonly createHardwareMachine: (link: MachineLink) => ConnectableMachine,
  ) {
    this.machine = createSimulator();
    this.unsubscribeFromMachine = this.observeMachine();
  }

  get activeMachine(): MachineController {
    return this.machine;
  }

  /** Address of the connected controller; `null` while the simulator is active. */
  get activeTarget(): MachineLinkTarget | null {
    return this.target;
  }

  /** @returns Function that cancels the subscription. */
  subscribe(listener: MachineStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  listSerialPorts(): Promise<readonly SerialPortInfo[]> {
    return this.linkProvider.listSerialPorts();
  }

  /** Connects to a controller, replacing the active machine only after it has answered. */
  async connect(target: MachineLinkTarget): Promise<Result<void, ConnectionFailure>> {
    if (!this.isSafeToSwitch()) {
      return err({ reason: ConnectionFailureReason.MachineBusy, systemMessage: null });
    }

    const linkResult = await this.linkProvider.open(target);
    if (!linkResult.ok) {
      return err({ reason: ConnectionFailureReason.LinkFailed, systemMessage: linkResult.error });
    }

    const hardwareMachine = this.createHardwareMachine(linkResult.value);
    if (!(await hardwareMachine.whenResponding(CONTROLLER_RESPONSE_TIMEOUT_MS))) {
      hardwareMachine.dispose();
      return err({ reason: ConnectionFailureReason.ControllerNotResponding, systemMessage: null });
    }

    this.replaceMachine(hardwareMachine, target);
    return ok(undefined);
  }

  /** Disconnects from hardware and returns to the simulator. */
  disconnect(): Result<void, ConnectionFailure> {
    if (!this.isSafeToSwitch()) {
      return err({ reason: ConnectionFailureReason.MachineBusy, systemMessage: null });
    }
    this.replaceMachine(this.createSimulator(), null);
    return ok(undefined);
  }

  private isSafeToSwitch(): boolean {
    const { status } = this.machine.getState();
    return status === MachineStatus.Idle || status === MachineStatus.Alarm;
  }

  private replaceMachine(machine: MachineController, target: MachineLinkTarget | null): void {
    this.unsubscribeFromMachine();
    this.machine.dispose();
    this.machine = machine;
    this.target = target;
    this.unsubscribeFromMachine = this.observeMachine();
    this.notifyListeners(machine.getState());
  }

  private observeMachine(): () => void {
    return this.machine.subscribe((state) => this.notifyListeners(state));
  }

  private notifyListeners(state: MachineState): void {
    for (const listener of this.listeners) listener(state);
  }
}
