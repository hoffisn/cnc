import { Axis, ORIGIN, distanceBetween, type Vector3 } from '@core/domain/geometry/vector3';
import { computeArcCenterFromRadius, validateArcCenter, type ArcCenterResult } from './arc';
import {
  COMMANDS_OWNING_THEIR_WORDS,
  CUTTER_COMPENSATION_COMMANDS,
  DRILL_CYCLE_COMMANDS,
  GCommand,
  GEOMETRY_NEUTRAL_COMMANDS,
  POST_MOTION_M_COMMANDS,
  PROGRAM_END_M_COMMANDS,
  toCommandCode,
} from './commands';
import { createDiagnostic, DiagnosticCode, type Diagnostic, type DiagnosticDetails } from './diagnostics';
import { tokenizeLine, type GCodeWord } from './lexer';
import { ArcPlane, ProgramStepKind, type GCodeProgram, type ProgramStep } from './program';

const MILLIMETERS_PER_INCH = 25.4;
const AXIS_LETTERS = ['X', 'Y', 'Z'] as const;
const ARC_PARAMETER_LETTERS = ['I', 'J', 'K', 'R'] as const;
const UNSUPPORTED_AXIS_LETTERS: ReadonlySet<string> = new Set(['A', 'B', 'C', 'U', 'V', 'W']);
/** Words identifying a block or program rather than instructing the machine. */
const LABEL_LETTERS: ReadonlySet<string> = new Set(['N', 'O']);
/** Words carried over to export next to the auxiliary command they belong to. */
const AUXILIARY_PARAMETER_LETTERS = ['H', 'D', 'S', 'T'] as const;
const OWNED_PARAMETER_LETTERS = ['P', 'S', 'L', 'R', ...AXIS_LETTERS] as const;

/** Active modal motion: what bare coordinates mean on the following lines. */
enum MotionMode {
  None = 'none',
  Rapid = 'rapid',
  LinearFeed = 'linear-feed',
  ArcClockwise = 'arc-clockwise',
  ArcCounterClockwise = 'arc-counter-clockwise',
  DrillCycle = 'drill-cycle',
}

/** How axis words are interpreted (`G90`/`G91`). */
enum DistanceMode {
  Absolute = 'absolute',
  Incremental = 'incremental',
}

/** How `I`/`J`/`K` words are interpreted (`G90.1`/`G91.1`). */
enum ArcCenterMode {
  Absolute = 'absolute',
  RelativeToStart = 'relative-to-start',
}

/** Where a drill cycle retracts after each hole (`G98`/`G99`). */
enum CycleRetractMode {
  InitialHeight = 'initial-height',
  RetractPlane = 'retract-plane',
}

/** Command of a block that is not a regular motion and replaces it. */
enum BlockAction {
  None = 'none',
  ReturnHome = 'return-home',
  SetCoordinateOffset = 'set-coordinate-offset',
  ClearCoordinateOffset = 'clear-coordinate-offset',
}

/** Address words of a block, by letter. */
type BlockParameters = ReadonlyMap<string, GCodeWord>;

const formatWord = (word: GCodeWord): string => `${word.letter}${word.numberText}`;

/**
 * Stateful G-code interpreter: tracks modal state line by line
 * and turns blocks into absolute, millimeter-based program steps.
 */
class GCodeInterpreter {
  private readonly steps: ProgramStep[] = [];
  private readonly diagnostics: Diagnostic[] = [];

  private toolPosition: Vector3 = ORIGIN;
  private coordinateOffset: Vector3 = ORIGIN;
  private motionMode = MotionMode.None;
  private plane = ArcPlane.XY;
  private millimetersPerUnit = 1;
  private distanceMode = DistanceMode.Absolute;
  private arcCenterMode = ArcCenterMode.RelativeToStart;
  private feedRate: number | null = null;
  private cycleRetractMode = CycleRetractMode.InitialHeight;
  private cycleRetractPlaneZ: number | null = null;
  private cycleBottomZ: number | null = null;
  private isProgramEnded = false;
  private hasReportedCodeAfterEnd = false;
  private hasReportedMissingFeedRate = false;

  interpret(source: string): GCodeProgram {
    const lines = source.split('\n');
    lines.forEach((text, index) => this.interpretLine(text, index + 1));
    return { steps: this.steps, diagnostics: this.diagnostics, lineCount: lines.length };
  }

  private report(code: DiagnosticCode, line: number, column: number, details?: DiagnosticDetails): void {
    this.diagnostics.push(createDiagnostic(code, line, column, details));
  }

  private interpretLine(text: string, line: number): void {
    const { words, diagnostics } = tokenizeLine(text, line);
    if (this.isProgramEnded) {
      if (words.length > 0 && !this.hasReportedCodeAfterEnd) {
        this.hasReportedCodeAfterEnd = true;
        this.report(DiagnosticCode.CodeAfterProgramEnd, line, 1);
      }
      return;
    }
    this.diagnostics.push(...diagnostics);
    if (words.length > 0) this.executeBlock(words, line);
  }

  /** Executes one block following the RS274/NGC order: modes first, then motion, then stops. */
  private executeBlock(words: readonly GCodeWord[], line: number): void {
    const gWords: GCodeWord[] = [];
    const mWords: GCodeWord[] = [];
    const parameters = new Map<string, GCodeWord>();

    for (const word of words) {
      if (LABEL_LETTERS.has(word.letter)) continue;
      if (word.letter === 'G') {
        gWords.push(word);
      } else if (word.letter === 'M') {
        mWords.push(word);
      } else if (UNSUPPORTED_AXIS_LETTERS.has(word.letter)) {
        this.report(DiagnosticCode.UnsupportedAxis, line, word.column, { character: word.letter });
      } else {
        if (parameters.has(word.letter)) {
          this.report(DiagnosticCode.DuplicateWord, line, word.column, { character: word.letter });
        }
        parameters.set(word.letter, word);
      }
    }

    const preMotionCommands: string[] = [];
    let blockAction = BlockAction.None;
    let isMachineCoordinateMove = false;
    let ownsParameters = false;

    for (const word of gWords) {
      const code = toCommandCode(word.value);
      switch (code) {
        case GCommand.RapidMove:
          this.motionMode = MotionMode.Rapid;
          break;
        case GCommand.LinearFeed:
          this.motionMode = MotionMode.LinearFeed;
          break;
        case GCommand.ArcClockwise:
          this.motionMode = MotionMode.ArcClockwise;
          break;
        case GCommand.ArcCounterClockwise:
          this.motionMode = MotionMode.ArcCounterClockwise;
          break;
        case GCommand.SelectPlaneXY:
          this.plane = ArcPlane.XY;
          break;
        case GCommand.SelectPlaneZX:
          this.plane = ArcPlane.ZX;
          break;
        case GCommand.SelectPlaneYZ:
          this.plane = ArcPlane.YZ;
          break;
        case GCommand.UnitsInches:
          this.millimetersPerUnit = MILLIMETERS_PER_INCH;
          break;
        case GCommand.UnitsMillimeters:
          this.millimetersPerUnit = 1;
          break;
        case GCommand.DistanceAbsolute:
          this.distanceMode = DistanceMode.Absolute;
          break;
        case GCommand.DistanceIncremental:
          this.distanceMode = DistanceMode.Incremental;
          break;
        case GCommand.ArcCenterAbsolute:
          this.arcCenterMode = ArcCenterMode.Absolute;
          break;
        case GCommand.ArcCenterIncremental:
          this.arcCenterMode = ArcCenterMode.RelativeToStart;
          break;
        case GCommand.ReturnHome:
        case GCommand.ReturnSecondaryHome:
          blockAction = BlockAction.ReturnHome;
          break;
        case GCommand.MachineCoordinates:
          isMachineCoordinateMove = true;
          this.report(DiagnosticCode.MachineCoordinatesApproximated, line, word.column);
          break;
        case GCommand.CannedCycleCancel:
          this.motionMode = MotionMode.None;
          this.cycleRetractPlaneZ = null;
          this.cycleBottomZ = null;
          break;
        case GCommand.SetCoordinateOffset:
          blockAction = BlockAction.SetCoordinateOffset;
          break;
        case GCommand.ClearCoordinateOffset:
          blockAction = BlockAction.ClearCoordinateOffset;
          break;
        case GCommand.CycleRetractToInitial:
          this.cycleRetractMode = CycleRetractMode.InitialHeight;
          break;
        case GCommand.CycleRetractToPlane:
          this.cycleRetractMode = CycleRetractMode.RetractPlane;
          break;
        default:
          if (DRILL_CYCLE_COMMANDS.has(code)) {
            this.motionMode = MotionMode.DrillCycle;
          } else if (GEOMETRY_NEUTRAL_COMMANDS.has(code)) {
            preMotionCommands.push(formatWord(word));
            ownsParameters = ownsParameters || COMMANDS_OWNING_THEIR_WORDS.has(code);
          } else if (CUTTER_COMPENSATION_COMMANDS.has(code)) {
            this.report(DiagnosticCode.CutterCompensationIgnored, line, word.column, { word: formatWord(word) });
            preMotionCommands.push(formatWord(word));
          } else {
            this.report(DiagnosticCode.UnsupportedCommand, line, word.column, { word: formatWord(word) });
          }
      }
    }

    this.applyFeedRate(parameters.get('F'), line);

    if (ownsParameters) {
      for (const letter of OWNED_PARAMETER_LETTERS) {
        const word = parameters.get(letter);
        if (word) {
          preMotionCommands.push(formatWord(word));
          parameters.delete(letter);
        }
      }
    }
    for (const letter of AUXILIARY_PARAMETER_LETTERS) {
      const word = parameters.get(letter);
      if (word) preMotionCommands.push(formatWord(word));
    }

    const postMotionCommands: string[] = [];
    let endsProgram = false;
    for (const word of mWords) {
      if (POST_MOTION_M_COMMANDS.has(word.value)) {
        postMotionCommands.push(formatWord(word));
        endsProgram = endsProgram || PROGRAM_END_M_COMMANDS.has(word.value);
      } else {
        preMotionCommands.push(formatWord(word));
      }
    }

    this.pushAuxiliary(preMotionCommands, line);

    switch (blockAction) {
      case BlockAction.SetCoordinateOffset:
        this.setCoordinateOffset(parameters);
        break;
      case BlockAction.ClearCoordinateOffset:
        this.coordinateOffset = ORIGIN;
        break;
      case BlockAction.ReturnHome:
        this.returnHome(parameters, line);
        break;
      case BlockAction.None:
        this.executeMotion(parameters, line, isMachineCoordinateMove);
        break;
    }

    this.pushAuxiliary(postMotionCommands, line);
    if (endsProgram) this.isProgramEnded = true;
  }

  private pushAuxiliary(commands: readonly string[], line: number): void {
    if (commands.length > 0) {
      this.steps.push({ kind: ProgramStepKind.Auxiliary, commandText: commands.join(' '), sourceLine: line });
    }
  }

  private applyFeedRate(feedWord: GCodeWord | undefined, line: number): void {
    if (!feedWord) return;
    if (feedWord.value <= 0) {
      this.report(DiagnosticCode.InvalidFeedRate, line, feedWord.column);
    } else {
      this.feedRate = feedWord.value * this.millimetersPerUnit;
    }
  }

  private resolveAxisTarget(word: GCodeWord | undefined, axis: Axis, ignoresOffset: boolean): number {
    const current = this.toolPosition[axis];
    if (!word) return current;
    const millimeters = word.value * this.millimetersPerUnit;
    if (this.distanceMode === DistanceMode.Incremental) return current + millimeters;
    return ignoresOffset ? millimeters : millimeters + this.coordinateOffset[axis];
  }

  private resolveTarget(parameters: BlockParameters, ignoresOffset = false): Vector3 {
    return {
      x: this.resolveAxisTarget(parameters.get('X'), Axis.X, ignoresOffset),
      y: this.resolveAxisTarget(parameters.get('Y'), Axis.Y, ignoresOffset),
      z: this.resolveAxisTarget(parameters.get('Z'), Axis.Z, ignoresOffset),
    };
  }

  /** `G92`: makes the current tool position read as the given coordinates. */
  private setCoordinateOffset(parameters: BlockParameters): void {
    const offsetFor = (letter: string, axis: Axis): number => {
      const word = parameters.get(letter);
      return word ? this.toolPosition[axis] - word.value * this.millimetersPerUnit : this.coordinateOffset[axis];
    };
    this.coordinateOffset = { x: offsetFor('X', Axis.X), y: offsetFor('Y', Axis.Y), z: offsetFor('Z', Axis.Z) };
  }

  /** `G28`/`G30`: rapid via an intermediate point to zero, along the named axes or along all of them. */
  private returnHome(parameters: BlockParameters, line: number): void {
    const namesAnyAxis = AXIS_LETTERS.some((letter) => parameters.has(letter));
    const intermediate = this.resolveTarget(parameters);
    const homeOrKeep = (letter: string, keptValue: number): number =>
      !namesAnyAxis || parameters.has(letter) ? 0 : keptValue;

    this.pushLinearMove(intermediate, true, line);
    this.pushLinearMove(
      { x: homeOrKeep('X', intermediate.x), y: homeOrKeep('Y', intermediate.y), z: homeOrKeep('Z', intermediate.z) },
      true,
      line,
    );
  }

  private executeMotion(parameters: BlockParameters, line: number, isMachineCoordinateMove: boolean): void {
    const hasAxisWords = AXIS_LETTERS.some((letter) => parameters.has(letter));
    const hasArcWords = ARC_PARAMETER_LETTERS.some((letter) => parameters.has(letter));

    switch (this.motionMode) {
      case MotionMode.Rapid:
        if (hasAxisWords) this.pushLinearMove(this.resolveTarget(parameters, isMachineCoordinateMove), true, line);
        break;
      case MotionMode.LinearFeed:
        if (hasAxisWords) {
          this.reportMissingFeedRate(parameters, line);
          this.pushLinearMove(this.resolveTarget(parameters, isMachineCoordinateMove), false, line);
        }
        break;
      case MotionMode.ArcClockwise:
      case MotionMode.ArcCounterClockwise:
        if (hasAxisWords || hasArcWords) {
          this.executeArc(parameters, this.motionMode === MotionMode.ArcClockwise, line);
        }
        break;
      case MotionMode.DrillCycle:
        if (hasAxisWords || parameters.has('R')) this.executeDrillCycle(parameters, line);
        break;
      case MotionMode.None:
        if (hasAxisWords) {
          this.report(DiagnosticCode.MissingMotionMode, line, this.firstAxisColumn(parameters));
        }
        break;
    }
  }

  private firstAxisColumn(parameters: BlockParameters): number {
    const axisWord = AXIS_LETTERS.map((letter) => parameters.get(letter)).find((word) => word !== undefined);
    return axisWord?.column ?? 1;
  }

  private reportMissingFeedRate(parameters: BlockParameters, line: number): void {
    if (this.feedRate === null && !this.hasReportedMissingFeedRate) {
      this.hasReportedMissingFeedRate = true;
      this.report(DiagnosticCode.MissingFeedRate, line, this.firstAxisColumn(parameters));
    }
  }

  /** Appends a straight move, skipping zero-length ones, and advances the tool. */
  private pushLinearMove(end: Vector3, isRapid: boolean, line: number): void {
    if (distanceBetween(this.toolPosition, end) > 0) {
      this.steps.push({
        kind: ProgramStepKind.LinearMove,
        isRapid,
        start: this.toolPosition,
        end,
        feedRate: isRapid ? null : this.feedRate,
        sourceLine: line,
      });
    }
    this.toolPosition = end;
  }

  private executeArc(parameters: BlockParameters, isClockwise: boolean, line: number): void {
    this.reportMissingFeedRate(parameters, line);
    const end = this.resolveTarget(parameters);
    const radiusWord = parameters.get('R');
    const centerWords = this.centerWordsOfCurrentPlane(parameters);
    const hasCenter = centerWords.length > 0;
    const anchorColumn = (radiusWord ?? centerWords[0])?.column ?? this.firstAxisColumn(parameters);

    if (radiusWord && hasCenter) {
      this.report(DiagnosticCode.ArcRadiusAndCenterConflict, line, radiusWord.column);
    }

    let centerResult: ArcCenterResult;
    if (hasCenter) {
      centerResult = validateArcCenter(this.toolPosition, end, this.resolveArcCenter(parameters), this.plane);
    } else if (radiusWord) {
      centerResult = computeArcCenterFromRadius(
        this.toolPosition,
        end,
        radiusWord.value * this.millimetersPerUnit,
        isClockwise,
        this.plane,
      );
    } else {
      centerResult = { ok: false, error: { code: DiagnosticCode.ArcMissingParameters, details: {} } };
    }

    if (!centerResult.ok) {
      // A straight line keeps the following moves correct, so later problems are still found.
      this.report(centerResult.error.code, line, anchorColumn, centerResult.error.details);
      this.pushLinearMove(end, false, line);
      return;
    }

    this.steps.push({
      kind: ProgramStepKind.ArcMove,
      isClockwise,
      plane: this.plane,
      start: this.toolPosition,
      end,
      center: centerResult.value,
      feedRate: this.feedRate,
      sourceLine: line,
    });
    this.toolPosition = end;
  }

  /** Center words that are meaningful in the active plane; others are ignored per RS274. */
  private centerWordsOfCurrentPlane(parameters: BlockParameters): GCodeWord[] {
    const lettersByPlane: Readonly<Record<ArcPlane, readonly [string, string]>> = {
      [ArcPlane.XY]: ['I', 'J'],
      [ArcPlane.ZX]: ['K', 'I'],
      [ArcPlane.YZ]: ['J', 'K'],
    };
    return lettersByPlane[this.plane]
      .map((letter) => parameters.get(letter))
      .filter((word): word is GCodeWord => word !== undefined);
  }

  private resolveArcCenter(parameters: BlockParameters): Vector3 {
    const resolveAxis = (letter: string, axis: Axis): number => {
      const word = parameters.get(letter);
      if (!word) return this.toolPosition[axis];
      const millimeters = word.value * this.millimetersPerUnit;
      return this.arcCenterMode === ArcCenterMode.Absolute
        ? millimeters + this.coordinateOffset[axis]
        : this.toolPosition[axis] + millimeters;
    };
    return { x: resolveAxis('I', Axis.X), y: resolveAxis('J', Axis.Y), z: resolveAxis('K', Axis.Z) };
  }

  /** Expands `G81`/`G82`/`G83`/`G85` into an approach, a plunge and a retract. */
  private executeDrillCycle(parameters: BlockParameters, line: number): void {
    if (this.distanceMode === DistanceMode.Incremental) {
      this.report(DiagnosticCode.DrillCycleIncrementalUnsupported, line, this.firstAxisColumn(parameters));
      return;
    }
    const bottomWord = parameters.get('Z');
    const retractWord = parameters.get('R');
    if (bottomWord) this.cycleBottomZ = bottomWord.value * this.millimetersPerUnit + this.coordinateOffset.z;
    if (retractWord) this.cycleRetractPlaneZ = retractWord.value * this.millimetersPerUnit + this.coordinateOffset.z;

    const { cycleBottomZ: bottomZ, cycleRetractPlaneZ: retractPlaneZ } = this;
    if (bottomZ === null || retractPlaneZ === null) {
      this.report(DiagnosticCode.DrillCycleMissingParameters, line, this.firstAxisColumn(parameters));
      return;
    }

    this.reportMissingFeedRate(parameters, line);
    const { x, y } = this.resolveTarget(parameters);
    const clearanceZ = Math.max(this.toolPosition.z, retractPlaneZ);
    const finalZ = this.cycleRetractMode === CycleRetractMode.InitialHeight ? clearanceZ : retractPlaneZ;

    this.pushLinearMove({ x, y, z: clearanceZ }, true, line);
    this.pushLinearMove({ x, y, z: retractPlaneZ }, true, line);
    this.pushLinearMove({ x, y, z: bottomZ }, false, line);
    this.pushLinearMove({ x, y, z: finalZ }, true, line);
  }
}

/**
 * Parses G-code text into a program.
 * Never throws on malformed input: every problem ends up in `diagnostics`,
 * so an operator's half-typed program remains previewable.
 */
export function parseGCode(source: string): GCodeProgram {
  return new GCodeInterpreter().interpret(source);
}
