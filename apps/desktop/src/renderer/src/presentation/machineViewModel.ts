import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import {
  MachineConnectionKind,
  MachineFaultKind,
  MachineStatus,
  homeMachine,
  jogMachine,
  runProgram,
  type GCodeProgram,
  type JogButton,
  type MachineConnectionService,
  type MachineLinkTarget,
  type MachineSettings,
  type MachineState,
  type ScaleTransform,
  type SerialPortInfo,
  type Toolpath,
} from '@rezets/core';
import {
  describeConnectionFailure,
  describeFault,
  describeJogRejection,
  describeRunRejection,
  describeLinkTarget,
} from './messages';
import { NotificationTone, type NotificationCenter } from './notificationCenter';

/** A simulation may run far faster than real time, which makes long programs watchable in a demo. */
const SIMULATOR_SPEED_OPTIONS: readonly number[] = [1, 5, 20];
/** Real controllers allow only a limited feed override around the programmed speed. */
const HARDWARE_SPEED_OPTIONS: readonly number[] = [0.5, 1, 1.5];
const DEFAULT_SIMULATOR_SPEED = 5;
const DEFAULT_HARDWARE_SPEED = 1;

/** State and commands of the machine, prepared for the UI. */
export class MachineViewModel {
  readonly state: ShallowRef<MachineState>;
  readonly activeTarget: ShallowRef<MachineLinkTarget | null> = shallowRef(null);
  readonly speedMultiplier: Ref<number> = ref(DEFAULT_SIMULATOR_SPEED);
  readonly speedOptions: ComputedRef<readonly number[]>;
  readonly isIdle: ComputedRef<boolean>;
  readonly isAlarm: ComputedRef<boolean>;
  readonly isProgramActive: ComputedRef<boolean>;
  readonly isSimulator: ComputedRef<boolean>;
  readonly connectionLabel: ComputedRef<string>;

  constructor(
    private readonly connectionService: MachineConnectionService,
    private readonly notifications: NotificationCenter,
    private readonly getSettings: () => MachineSettings,
  ) {
    this.state = shallowRef(connectionService.activeMachine.getState());
    connectionService.subscribe((state) => {
      this.state.value = state;
    });
    connectionService.activeMachine.setSpeedMultiplier(DEFAULT_SIMULATOR_SPEED);

    this.isIdle = computed(() => this.state.value.status === MachineStatus.Idle);
    this.isAlarm = computed(() => this.state.value.status === MachineStatus.Alarm);
    this.isProgramActive = computed(
      () => this.state.value.status === MachineStatus.RunningProgram || this.state.value.status === MachineStatus.ProgramPaused,
    );
    this.isSimulator = computed(() => this.state.value.connectionKind === MachineConnectionKind.Simulator);
    this.speedOptions = computed(() => (this.isSimulator.value ? SIMULATOR_SPEED_OPTIONS : HARDWARE_SPEED_OPTIONS));
    this.connectionLabel = computed(() => {
      const target = this.activeTarget.value;
      return target ? describeLinkTarget(target) : 'Симулятор';
    });

    watch(
      () => this.state.value.fault,
      (fault) => {
        if (!fault) return;
        const tone = fault.kind === MachineFaultKind.CommandRejected ? NotificationTone.Warning : NotificationTone.Error;
        this.notifications.show(tone, describeFault(fault));
      },
    );
  }

  private get machine() {
    return this.connectionService.activeMachine;
  }

  jog(button: JogButton): void {
    const result = jogMachine(this.machine, button, this.getSettings());
    if (!result.ok) this.notifications.show(NotificationTone.Warning, describeJogRejection(result.error));
  }

  goHome(): void {
    const result = homeMachine(this.machine, this.getSettings());
    if (!result.ok) this.notifications.show(NotificationTone.Warning, describeJogRejection(result.error));
  }

  startProgram(program: GCodeProgram, toolpath: Toolpath, scale: ScaleTransform): void {
    const result = runProgram(this.machine, program, toolpath, scale, this.getSettings());
    if (!result.ok) this.notifications.show(NotificationTone.Warning, describeRunRejection(result.error));
  }

  pauseProgram(): void {
    this.machine.pauseProgram();
  }

  resumeProgram(): void {
    this.machine.resumeProgram();
  }

  stop(): void {
    this.machine.stop();
  }

  emergencyStop(): void {
    this.machine.emergencyStop();
  }

  clearAlarm(): void {
    this.machine.clearAlarm();
  }

  setSpeedMultiplier(multiplier: number): void {
    this.speedMultiplier.value = multiplier;
    this.machine.setSpeedMultiplier(multiplier);
  }

  listSerialPorts(): Promise<readonly SerialPortInfo[]> {
    return this.connectionService.listSerialPorts();
  }

  /** @returns Text explaining the failure, or `null` on success. */
  async connect(target: MachineLinkTarget): Promise<string | null> {
    const result = await this.connectionService.connect(target);
    if (!result.ok) return describeConnectionFailure(result.error);
    this.activeTarget.value = target;
    this.setSpeedMultiplier(DEFAULT_HARDWARE_SPEED);
    this.notifications.show(NotificationTone.Success, `Станок подключён: ${describeLinkTarget(target)}`);
    return null;
  }

  /** @returns Text explaining the failure, or `null` on success. */
  disconnect(): string | null {
    const result = this.connectionService.disconnect();
    if (!result.ok) return describeConnectionFailure(result.error);
    this.activeTarget.value = null;
    this.setSpeedMultiplier(DEFAULT_SIMULATOR_SPEED);
    return null;
  }
}
