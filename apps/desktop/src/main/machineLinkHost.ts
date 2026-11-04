import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { SerialPort } from 'serialport';
import {
  MachineLinkKind,
  err,
  ok,
  type MachineLinkTarget,
  type Result,
  type SerialLinkTarget,
  type SerialPortInfo,
  type TcpLinkTarget,
} from '@rezets/core';

const TCP_CONNECT_TIMEOUT_MS = 5000;
/** Grbl realtime commands are single bytes above 0x7F, which UTF-8 would split into two. */
const LINK_ENCODING = 'latin1';

function openSerialStream(target: SerialLinkTarget): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path: target.portPath, baudRate: target.baudRate, autoOpen: false });
    port.open((failure) => (failure ? reject(failure) : resolve(port)));
  });
}

function openTcpStream(target: TcpLinkTarget): Promise<Duplex> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: target.host, port: target.port });
    // Commands must reach the machine immediately rather than wait in Nagle's buffer.
    socket.setNoDelay(true);
    socket.setTimeout(TCP_CONNECT_TIMEOUT_MS, () => socket.destroy(new Error('Истекло время ожидания ответа')));
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.setTimeout(0);
      socket.off('error', reject);
      resolve(socket);
    });
  });
}

const openStream = (target: MachineLinkTarget): Promise<Duplex> =>
  target.kind === MachineLinkKind.Serial ? openSerialStream(target) : openTcpStream(target);

/** Events a link delivers to the renderer. */
export interface MachineLinkEvents {
  onData(chunk: string): void;
  onClosed(): void;
}

/**
 * Owns the single open channel to a machine controller.
 * Lives in the main process because only it may touch serial ports and sockets; the protocol itself
 * is spoken by the driver in the core, and this host just moves bytes.
 */
export class MachineLinkHost {
  private stream: Duplex | null = null;

  constructor(private readonly events: MachineLinkEvents) {}

  async listSerialPorts(): Promise<SerialPortInfo[]> {
    const ports = await SerialPort.list();
    return ports.map((port) => ({ portPath: port.path, manufacturer: port.manufacturer ?? null }));
  }

  /** Opens a channel, replacing any existing one. */
  async open(target: MachineLinkTarget): Promise<Result<void, string>> {
    this.close();
    try {
      const stream = await openStream(target);
      stream.on('data', (chunk: Buffer) => this.events.onData(chunk.toString(LINK_ENCODING)));
      stream.on('error', () => stream.destroy());
      stream.once('close', () => {
        if (this.stream === stream) {
          this.stream = null;
          this.events.onClosed();
        }
      });
      this.stream = stream;
      return ok(undefined);
    } catch (cause) {
      return err(cause instanceof Error ? cause.message : String(cause));
    }
  }

  write(data: string): void {
    this.stream?.write(Buffer.from(data, LINK_ENCODING));
  }

  /** Closes the channel on request, so no "closed" event is sent for it. */
  close(): void {
    const stream = this.stream;
    this.stream = null;
    stream?.destroy();
  }
}
