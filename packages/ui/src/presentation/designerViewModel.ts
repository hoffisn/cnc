import { computed, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue';
import {
  DEFAULT_HOLDING_TABS,
  DesignOperationKind,
  IDENTITY_SCALE,
  SaveProgramStatus,
  ShapeCut,
  ToolSide,
  boundsSize,
  buildToolpath,
  computeRelief,
  createShapeFromPoints,
  describeSheetStock,
  findPathsBounds,
  findDesignIssues,
  generateDesignGCode,
  parseGCode,
  translateOperation,
  type Bounds,
  type DesignIssue,
  type DesignOperation,
  type DesignProject,
  type DesignProjectService,
  type GCodeProgram,
  type MachineSettings,
  type ProgramFileGateway,
  type Relief,
  type SheetPoint,
  type Toolpath,
  type Vector3,
  type WorkSurface,
} from '@rezets/core';
import { DrawingImportFailure, importDrawing } from '@ui/infrastructure/drawingImport';
import { createExampleOperations } from '@ui/presentation/designExample';
import type { MachineViewModel } from '@ui/presentation/machineViewModel';
import { AppSection } from '@ui/presentation/navigation';
import { NotificationTone, type NotificationCenter } from '@ui/presentation/notificationCenter';
import type { ProgramWorkspace } from '@ui/presentation/programWorkspace';

const DESIGN_PROGRAM_FILE_NAME = 'design.nc';

const IMPORT_FAILURE_MESSAGES: Readonly<Record<DrawingImportFailure, string>> = {
  [DrawingImportFailure.UnknownFormat]: 'Поддерживаются чертежи SVG и DXF',
  [DrawingImportFailure.Unreadable]: 'Не удалось прочитать чертёж: файл повреждён или это не SVG и не DXF',
  [DrawingImportFailure.NoLines]: 'В чертеже нет линий, по которым может пройти фреза',
};
const PREVIEW_CHORD_TOLERANCE_MM = 0.05;
const RELIEF_DELAY_MS = 120;
const DEFAULT_SNAP_STEP_MM = 5;
/** Where a duplicate lands relative to the original, so that it is immediately visible. */
const DUPLICATE_OFFSET_MM = 20;

/** Center area of the designer. */
export enum DesignerView {
  Drawing = 'drawing',
  Preview = 'preview',
}

/** Collaborators of the designer screen. */
export interface DesignerDependencies {
  readonly projectService: DesignProjectService;
  readonly fileGateway: ProgramFileGateway;
  readonly workspace: ProgramWorkspace;
  readonly machine: MachineViewModel;
  readonly notifications: NotificationCenter;
  readonly activeSection: Ref<AppSection>;
  /** Grid nodes along the sheet's longer side when predicting the part. */
  readonly reliefResolution: number;
  readonly getMachineSettings: () => MachineSettings;
  readonly updateMachineSettings: (settings: MachineSettings) => void;
}

/** State and commands of the work surface and designer screens. */
export class DesignerViewModel {
  readonly project: ShallowRef<DesignProject>;
  readonly canUndo: Ref<boolean> = ref(false);
  readonly canRedo: Ref<boolean> = ref(false);
  readonly selectedOperationId: Ref<string | null> = ref(null);
  /** Shape being drawn with the pointer; `null` means selecting and moving existing shapes. */
  readonly activeTool: Ref<DesignOperationKind | null> = ref(null);
  readonly snapStepMm: Ref<number> = ref(DEFAULT_SNAP_STEP_MM);
  readonly view: Ref<DesignerView> = ref(DesignerView.Drawing);
  readonly relief: ShallowRef<Relief | null> = shallowRef(null);

  readonly issues: ComputedRef<readonly DesignIssue[]>;
  readonly program: ComputedRef<GCodeProgram>;
  readonly toolpath: ComputedRef<Toolpath>;
  readonly partSize: ComputedRef<Vector3 | null>;
  readonly selectedOperation: ComputedRef<DesignOperation | null>;
  readonly sheetBounds: ComputedRef<Bounds>;
  readonly generatedText: ComputedRef<string>;

  private reliefTimer: number | undefined;

  constructor(private readonly dependencies: DesignerDependencies) {
    const { projectService } = dependencies;
    this.project = shallowRef(projectService.current);
    projectService.subscribe((project) => {
      this.project.value = project;
      this.canUndo.value = projectService.canUndo;
      this.canRedo.value = projectService.canRedo;
      const selectedId = this.selectedOperationId.value;
      if (selectedId && !project.operations.some((operation) => operation.id === selectedId)) {
        this.selectedOperationId.value = null;
      }
    });

    this.issues = computed(() => findDesignIssues(this.project.value));
    this.generatedText = computed(() => generateDesignGCode(this.project.value));
    this.program = computed(() => parseGCode(this.generatedText.value));
    this.toolpath = computed(() => buildToolpath(this.program.value, IDENTITY_SCALE, PREVIEW_CHORD_TOLERANCE_MM));
    this.partSize = computed(() => {
      const { partBounds } = this.toolpath.value;
      return partBounds ? boundsSize(partBounds) : null;
    });
    this.selectedOperation = computed(
      () => this.project.value.operations.find((operation) => operation.id === this.selectedOperationId.value) ?? null,
    );
    this.sheetBounds = computed(() => {
      const stock = describeSheetStock(this.project.value.surface);
      return {
        min: { x: stock.minX, y: stock.minY, z: stock.bottomZ },
        max: { x: stock.maxX, y: stock.maxY, z: stock.topZ },
      };
    });

    // Carving a whole sheet is the heaviest calculation, so it runs only while its result is on screen.
    watch([this.toolpath, this.view], () => this.scheduleReliefUpdate(), { immediate: true });
  }

  updateSurface(surface: WorkSurface): void {
    this.dependencies.projectService.updateSurface(surface);
  }

  drawOperation(kind: DesignOperationKind, start: SheetPoint, end: SheetPoint): void {
    const operation = this.dependencies.projectService.drawOperation(kind, start, end);
    this.selectedOperationId.value = operation.id;
    this.activeTool.value = null;
  }

  /** Adds a shape drawn point by point: a closed one is cut out, an open one engraved. */
  drawShape(points: readonly SheetPoint[], isClosed: boolean): void {
    const operation = this.dependencies.projectService.addOperation((id, depthMm) =>
      createShapeFromPoints({ id, points, isClosed, depthMm }),
    );
    this.selectedOperationId.value = operation.id;
    this.activeTool.value = null;
  }

  /**
   * Places a drawing from another program in the middle of the sheet, at its real size.
   * Closed outlines are cut out; a drawing of open lines only is engraved.
   */
  importDrawing(fileName: string, text: string): void {
    const { notifications, projectService } = this.dependencies;
    const result = importDrawing(fileName, text);
    if (!result.ok) {
      notifications.show(NotificationTone.Error, IMPORT_FAILURE_MESSAGES[result.error]);
      return;
    }
    const bounds = findPathsBounds(result.value);
    if (!bounds) return;
    const { surface } = this.project.value;
    const shiftX = surface.sheetWidthMm / 2 - (bounds.minX + bounds.maxX) / 2;
    const shiftY = surface.sheetDepthMm / 2 - (bounds.minY + bounds.maxY) / 2;
    const paths = result.value.map((path) => ({
      ...path,
      points: path.points.map((point) => ({ x: point.x + shiftX, y: point.y + shiftY })),
    }));
    const operation = projectService.addOperation((id, depthMm) => ({
      kind: DesignOperationKind.Shape,
      id,
      depthMm,
      paths,
      cut: paths.some((path) => path.isClosed) ? ShapeCut.Outline : ShapeCut.Engrave,
      toolSide: ToolSide.Outside,
      tabs: DEFAULT_HOLDING_TABS,
    }));
    this.selectedOperationId.value = operation.id;
    const isLargerThanSheet = bounds.maxX - bounds.minX > surface.sheetWidthMm || bounds.maxY - bounds.minY > surface.sheetDepthMm;
    notifications.show(
      isLargerThanSheet ? NotificationTone.Warning : NotificationTone.Success,
      isLargerThanSheet ? 'Чертёж больше листа: уменьшите его в свойствах справа' : `Чертёж «${fileName}» добавлен на лист`,
    );
  }

  updateOperation(operation: DesignOperation): void {
    this.dependencies.projectService.updateOperation(operation);
  }

  removeSelectedOperation(): void {
    const operationId = this.selectedOperationId.value;
    if (operationId) this.dependencies.projectService.removeOperation(operationId);
  }

  duplicateSelectedOperation(): void {
    const operationId = this.selectedOperationId.value;
    if (!operationId) return;
    const copy = this.dependencies.projectService.duplicateOperation(operationId, (operation) =>
      translateOperation(operation, DUPLICATE_OFFSET_MM, DUPLICATE_OFFSET_MM),
    );
    if (copy) this.selectedOperationId.value = copy.id;
  }

  reorderOperation(operationId: string, positionDelta: number): void {
    this.dependencies.projectService.reorderOperation(operationId, positionDelta);
  }

  undo(): void {
    this.dependencies.projectService.undo();
  }

  redo(): void {
    this.dependencies.projectService.redo();
  }

  addExample(): void {
    const { surface } = this.project.value;
    this.dependencies.projectService.replaceOperations((generateId) => createExampleOperations(surface, generateId));
    this.selectedOperationId.value = null;
  }

  /**
   * Hands the design over to the machine screen as a regular program.
   * From there on it follows the same path as any file: preview, stretching, run.
   */
  sendToMachine(): void {
    const { notifications, machine, workspace, activeSection, getMachineSettings, updateMachineSettings } = this.dependencies;
    if (!this.isReadyForOutput()) return;
    if (machine.isProgramActive.value) {
      notifications.show(NotificationTone.Warning, 'Станок выполняет программу: дождитесь окончания');
      return;
    }
    const { toolDiameterMm } = this.project.value.surface;
    updateMachineSettings({ ...getMachineSettings(), toolDiameter: toolDiameterMm });
    workspace.loadFile({ fileName: DESIGN_PROGRAM_FILE_NAME, text: this.generatedText.value });
    activeSection.value = AppSection.Machine;
    notifications.show(NotificationTone.Success, 'Программа собрана и загружена на экран станка');
  }

  async saveGCode(): Promise<void> {
    if (!this.isReadyForOutput()) return;
    const { fileGateway, notifications } = this.dependencies;
    const result = await fileGateway.save(DESIGN_PROGRAM_FILE_NAME, this.generatedText.value);
    if (result.status === SaveProgramStatus.Saved) {
      notifications.show(NotificationTone.Success, `Сохранено: ${result.fileName}`);
    } else if (result.status === SaveProgramStatus.Failed) {
      notifications.show(NotificationTone.Error, `Не удалось сохранить файл: ${result.failureReason}`);
    }
  }

  private isReadyForOutput(): boolean {
    const { notifications } = this.dependencies;
    if (this.project.value.operations.length === 0) {
      notifications.show(NotificationTone.Warning, 'Добавьте на лист хотя бы одну операцию');
      return false;
    }
    if (this.issues.value.length > 0) {
      notifications.show(NotificationTone.Warning, 'Сначала исправьте проблемы в операциях');
      return false;
    }
    return true;
  }

  private scheduleReliefUpdate(): void {
    window.clearTimeout(this.reliefTimer);
    if (this.view.value !== DesignerView.Preview) return;
    this.reliefTimer = window.setTimeout(() => {
      const { surface } = this.project.value;
      this.relief.value = computeRelief(this.toolpath.value, {
        toolDiameter: surface.toolDiameterMm,
        maxResolution: this.dependencies.reliefResolution,
        stock: describeSheetStock(surface),
      });
    }, RELIEF_DELAY_MS);
  }
}
