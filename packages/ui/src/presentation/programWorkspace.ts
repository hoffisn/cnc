import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import {
  CommandRejectionReason,
  DiagnosticSeverity,
  IDENTITY_SCALE,
  OpenProgramStatus,
  SaveProgramStatus,
  boundsSize,
  buildToolpath,
  computeRelief,
  exportProgram,
  isIdentityScale,
  parseGCode,
  setAxisScaleFactor,
  setAxisTargetSize,
  type Axis,
  type GCodeProgram,
  type ProgramFile,
  type ProgramFileGateway,
  type ProgramFileLocation,
  type Relief,
  type ScaleTransform,
  type Toolpath,
  type Vector3,
} from '@rezets/core';
import { NotificationTone, type NotificationCenter } from './notificationCenter';

/** Pause after the last keystroke before reparsing: typing must stay fluid on long programs. */
const REPARSE_DELAY_MS = 150;
/** Pause before recomputing the part, the heaviest calculation, while a slider is dragged. */
const RELIEF_DELAY_MS = 120;
const PREVIEW_CHORD_TOLERANCE_MM = 0.02;

/** The program being worked on: its text, geometry, and how the figure is stretched. */
export class ProgramWorkspace {
  readonly sourceText: Ref<string> = ref('');
  readonly fileName: Ref<string | null> = ref(null);
  readonly program: ShallowRef<GCodeProgram> = shallowRef(parseGCode(''));
  readonly scale: ShallowRef<ScaleTransform> = shallowRef(IDENTITY_SCALE);
  readonly keepProportions: Ref<boolean> = ref(true);
  readonly relief: ShallowRef<Relief | null> = shallowRef(null);
  /** Source line under the editor's caret, shown in the viewport. */
  readonly focusedLine: Ref<number | null> = ref(null);

  readonly toolpath: ComputedRef<Toolpath>;
  readonly partSize: ComputedRef<Vector3 | null>;
  readonly errorCount: ComputedRef<number>;
  readonly warningCount: ComputedRef<number>;
  readonly isScaleUniformInAllAxes: ComputedRef<boolean>;
  readonly isScaled: ComputedRef<boolean>;

  private reparseTimer: number | undefined;
  private reliefTimer: number | undefined;

  constructor(
    private readonly fileGateway: ProgramFileGateway,
    private readonly notifications: NotificationCenter,
    private readonly getToolDiameter: () => number,
    private readonly reliefResolution: number,
  ) {
    this.toolpath = computed(() => buildToolpath(this.program.value, this.scale.value, PREVIEW_CHORD_TOLERANCE_MM));
    this.partSize = computed(() => {
      const { partBounds } = this.toolpath.value;
      return partBounds ? boundsSize(partBounds) : null;
    });
    const countBySeverity = (severity: DiagnosticSeverity): number =>
      this.program.value.diagnostics.filter((diagnostic) => diagnostic.severity === severity).length;
    this.errorCount = computed(() => countBySeverity(DiagnosticSeverity.Error));
    this.warningCount = computed(() => countBySeverity(DiagnosticSeverity.Warning));
    this.isScaled = computed(() => !isIdentityScale(this.scale.value));
    this.isScaleUniformInAllAxes = computed(() => {
      const { x, y, z } = this.scale.value;
      return x === y && y === z;
    });

    watch([this.toolpath, this.getToolDiameter], () => this.scheduleReliefUpdate());
    this.scheduleReliefUpdate();
  }

  /** Applies text typed by the operator; the geometry follows after a short pause. */
  editSource(text: string): void {
    this.sourceText.value = text;
    window.clearTimeout(this.reparseTimer);
    this.reparseTimer = window.setTimeout(() => {
      this.program.value = parseGCode(this.sourceText.value);
    }, REPARSE_DELAY_MS);
  }

  /** Replaces the program, resetting the stretch made for the previous figure. */
  loadFile(file: ProgramFile): void {
    window.clearTimeout(this.reparseTimer);
    this.sourceText.value = file.text;
    this.fileName.value = file.fileName;
    this.scale.value = IDENTITY_SCALE;
    this.focusedLine.value = null;
    this.program.value = parseGCode(file.text);
  }

  async openFromDevice(location: ProgramFileLocation): Promise<void> {
    const result = await this.fileGateway.open(location);
    switch (result.status) {
      case OpenProgramStatus.Opened:
        if (result.isRemovableDriveMissing) this.notifyRemovableDriveMissing();
        this.loadFile(result.file);
        this.notifications.show(NotificationTone.Success, `Загружена программа ${result.file.fileName}`);
        break;
      case OpenProgramStatus.Cancelled:
        if (result.isRemovableDriveMissing) this.notifyRemovableDriveMissing();
        break;
      case OpenProgramStatus.Failed:
        this.notifications.show(NotificationTone.Error, `Не удалось открыть файл: ${result.failureReason}`);
        break;
    }
  }

  async saveToDevice(): Promise<void> {
    const result = await exportProgram(this.fileGateway, this.program.value, this.scale.value, this.fileName.value);
    if (!result.ok) {
      if (result.error.reason === CommandRejectionReason.ProgramHasErrors) {
        this.notifications.show(NotificationTone.Warning, 'В программе есть ошибки: исправьте их перед сохранением');
      }
      return;
    }
    const saveResult = result.value;
    switch (saveResult.status) {
      case SaveProgramStatus.Saved:
        this.notifications.show(NotificationTone.Success, `Сохранено: ${saveResult.fileName}`);
        break;
      case SaveProgramStatus.Failed:
        this.notifications.show(NotificationTone.Error, `Не удалось сохранить файл: ${saveResult.failureReason}`);
        break;
      case SaveProgramStatus.Cancelled:
        break;
    }
  }

  setAxisFactor(axis: Axis, factor: number): void {
    this.scale.value = setAxisScaleFactor(this.scale.value, axis, factor, this.keepProportions.value);
  }

  setAxisSize(axis: Axis, targetSize: number): void {
    const currentSize = this.partSize.value?.[axis] ?? 0;
    const unscaledSize = currentSize / this.scale.value[axis];
    this.scale.value = setAxisTargetSize(this.scale.value, axis, unscaledSize, targetSize, this.keepProportions.value);
  }

  resetScale(): void {
    this.scale.value = IDENTITY_SCALE;
  }

  private notifyRemovableDriveMissing(): void {
    this.notifications.show(NotificationTone.Info, 'Флешка не найдена: открыта обычная папка');
  }

  private scheduleReliefUpdate(): void {
    window.clearTimeout(this.reliefTimer);
    this.reliefTimer = window.setTimeout(() => {
      this.relief.value = computeRelief(this.toolpath.value, {
        toolDiameter: this.getToolDiameter(),
        maxResolution: this.reliefResolution,
      });
    }, RELIEF_DELAY_MS);
  }
}
