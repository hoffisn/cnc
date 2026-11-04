import type { Result } from '@core/domain/shared/result';

/** Physical channel to a machine controller. */
export enum MachineLinkKind {
  /** USB-serial or RS-232, seen by the operating system as a COM port. */
  Serial = 'serial',
  /** Ethernet or Wi-Fi. */
  Tcp = 'tcp',
}

/** Where to find a controller on a serial port. */
export interface SerialLinkTarget {
  readonly kind: MachineLinkKind.Serial;
  /** Operating system port name: `COM3`, `/dev/ttyUSB0`. */
  readonly portPath: string;
  readonly baudRate: number;
}

/** Where to find a controller on the network. */
export interface TcpLinkTarget {
  readonly kind: MachineLinkKind.Tcp;
  readonly host: string;
  readonly port: number;
}

/** Address of a machine controller. */
export type MachineLinkTarget = SerialLinkTarget | TcpLinkTarget;

/** Serial port found on this computer. */
export interface SerialPortInfo {
  readonly portPath: string;
  /** Device manufacturer, when the operating system knows it. */
  readonly manufacturer: string | null;
}

/** Open byte channel to a controller. Text is transferred as Latin-1, so each character is one byte. */
export interface MachineLink {
  write(data: string): void;
  /** Sets the function receiving incoming data, in arbitrary chunks. */
  onData(listener: (chunk: string) => void): void;
  /** Sets the function called once when the channel closes for any reason. */
  onClosed(listener: () => void): void;
  close(): void;
}

/** Output port that discovers and opens channels to controllers. */
export interface MachineLinkProvider {
  listSerialPorts(): Promise<readonly SerialPortInfo[]>;
  /** @returns The open channel, or the operating system's explanation of the failure. */
  open(target: MachineLinkTarget): Promise<Result<MachineLink, string>>;
}
