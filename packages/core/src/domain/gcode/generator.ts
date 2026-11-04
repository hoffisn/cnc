import { Axis, type Vector3 } from '@core/domain/geometry/vector3';
import { applyScale, type ScaleTransform } from '@core/domain/transform/scaleTransform';
import { tessellateArc, toPlanePoint } from './arc';
import { ArcPlane, ProgramStepKind, type ArcMove, type GCodeProgram, type LinearMove } from './program';

/** Maximum deviation of an arc replaced by line segments on export, in millimeters. */
const EXPORT_CHORD_TOLERANCE_MM = 0.01;
const COORDINATE_DECIMALS = 4;
/** Source line assigned to generated blocks that have no counterpart in the source. */
const NO_SOURCE_LINE = 0;

const PLANE_SELECT_COMMAND: Readonly<Record<ArcPlane, string>> = {
  [ArcPlane.XY]: 'G17',
  [ArcPlane.ZX]: 'G18',
  [ArcPlane.YZ]: 'G19',
};

const PLANE_AXES: Readonly<Record<ArcPlane, readonly [Axis, Axis]>> = {
  [ArcPlane.XY]: [Axis.X, Axis.Y],
  [ArcPlane.ZX]: [Axis.Z, Axis.X],
  [ArcPlane.YZ]: [Axis.Y, Axis.Z],
};

/** One line of generated G-code. */
export interface GeneratedBlock {
  readonly text: string;
  /** Line of the source program this block came from, which lets execution be traced back to it. */
  readonly sourceLine: number;
}

/** Formats a coordinate the way controllers expect: no trailing zeros, no negative zero. */
export function formatCoordinate(value: number): string {
  const trimmed = value.toFixed(COORDINATE_DECIMALS).replace(/\.?0+$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

/** Accumulates generated blocks along with the modal state of the generated program. */
class GCodeWriter {
  readonly blocks: GeneratedBlock[] = [];
  private activePlane = ArcPlane.XY;
  private activeFeedRate: number | null = null;
  private isPositionKnown = false;
  private currentSourceLine = NO_SOURCE_LINE;

  constructor(private readonly scale: ScaleTransform) {
    this.emit(`(REZETS SCALE X${formatCoordinate(scale.x)} Y${formatCoordinate(scale.y)} Z${formatCoordinate(scale.z)})`);
    this.emit('G21 G90 G17');
  }

  setSourceLine(sourceLine: number): void {
    this.currentSourceLine = sourceLine;
  }

  writeCommand(commandText: string): void {
    this.emit(commandText);
  }

  writeLinearMove(move: LinearMove): void {
    this.writeLine(move.start, move.end, move.isRapid ? 'G0' : 'G1', move.feedRate);
  }

  /**
   * Writes an arc. It stays an arc only when its plane is scaled uniformly: otherwise the circle
   * becomes an ellipse, which `G2`/`G3` cannot express, so it is replaced by line segments.
   */
  writeArc(arc: ArcMove, chordTolerance: number): void {
    const [firstAxis, secondAxis] = PLANE_AXES[arc.plane];
    const planeScale = this.scale[firstAxis];
    if (planeScale !== this.scale[secondAxis]) {
      let segmentStart = arc.start;
      for (const segmentEnd of tessellateArc(arc, chordTolerance)) {
        this.writeLine(segmentStart, segmentEnd, 'G1', arc.feedRate);
        segmentStart = segmentEnd;
      }
      return;
    }

    if (arc.plane !== this.activePlane) {
      this.activePlane = arc.plane;
      this.emit(PLANE_SELECT_COMMAND[arc.plane]);
    }
    const end = applyScale(arc.end, this.scale);
    const planeStart = toPlanePoint(arc.start, arc.plane);
    const planeCenter = toPlanePoint(arc.center, arc.plane);
    const firstOffset = formatCoordinate((planeCenter.first - planeStart.first) * planeScale);
    const secondOffset = formatCoordinate((planeCenter.second - planeStart.second) * planeScale);
    const centerWords: Readonly<Record<ArcPlane, string>> = {
      [ArcPlane.XY]: `I${firstOffset} J${secondOffset}`,
      [ArcPlane.ZX]: `I${secondOffset} K${firstOffset}`,
      [ArcPlane.YZ]: `J${firstOffset} K${secondOffset}`,
    };
    // All axes are always written: a full circle has no changed coordinates yet must still be a move.
    this.emit(
      `${arc.isClockwise ? 'G2' : 'G3'} X${formatCoordinate(end.x)} Y${formatCoordinate(end.y)} Z${formatCoordinate(end.z)} ` +
        `${centerWords[arc.plane]}${this.feedRateWord(arc.feedRate)}`,
    );
    this.isPositionKnown = true;
  }

  private emit(text: string): void {
    this.blocks.push({ text, sourceLine: this.currentSourceLine });
  }

  private writeLine(start: Vector3, end: Vector3, command: string, feedRate: number | null): void {
    const axisWords = this.axisWords(start, end);
    if (axisWords === '') return;
    this.emit(`${command}${axisWords}${command === 'G1' ? this.feedRateWord(feedRate) : ''}`);
    this.isPositionKnown = true;
  }

  /** Writes only the axes that change, except on the first move, when the machine position is unknown. */
  private axisWords(start: Vector3, end: Vector3): string {
    const scaledStart = applyScale(start, this.scale);
    const scaledEnd = applyScale(end, this.scale);
    const wordFor = (letter: string, from: number, to: number): string => {
      const target = formatCoordinate(to);
      return this.isPositionKnown && formatCoordinate(from) === target ? '' : ` ${letter}${target}`;
    };
    return (
      wordFor('X', scaledStart.x, scaledEnd.x) +
      wordFor('Y', scaledStart.y, scaledEnd.y) +
      wordFor('Z', scaledStart.z, scaledEnd.z)
    );
  }

  private feedRateWord(feedRate: number | null): string {
    if (feedRate === null || feedRate === this.activeFeedRate) return '';
    this.activeFeedRate = feedRate;
    return ` F${formatCoordinate(feedRate)}`;
  }
}

/**
 * Generates the blocks to actually send to a machine, with scaling applied.
 * The output is always absolute and metric, whatever modes the source used.
 */
export function generateGCodeBlocks(program: GCodeProgram, scale: ScaleTransform): GeneratedBlock[] {
  const writer = new GCodeWriter(scale);
  const sourceChordTolerance = EXPORT_CHORD_TOLERANCE_MM / Math.max(scale.x, scale.y, scale.z);

  for (const step of program.steps) {
    writer.setSourceLine(step.sourceLine);
    switch (step.kind) {
      case ProgramStepKind.Auxiliary:
        writer.writeCommand(step.commandText);
        break;
      case ProgramStepKind.LinearMove:
        writer.writeLinearMove(step);
        break;
      case ProgramStepKind.ArcMove:
        writer.writeArc(step, sourceChordTolerance);
        break;
    }
  }
  return writer.blocks;
}

/** Generates a complete G-code file, see {@link generateGCodeBlocks}. */
export function generateGCode(program: GCodeProgram, scale: ScaleTransform): string {
  return `${generateGCodeBlocks(program, scale).map((block) => block.text).join('\n')}\n`;
}
