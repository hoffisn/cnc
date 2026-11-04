import type { DesignOperation, SheetPoint, DesignOperationKind } from '@core/domain/design/designOperation';
import { EMPTY_DESIGN_PROJECT, parseDesignProject, type DesignProject } from '@core/domain/design/designProject';
import { createOperationFromDrawing } from '@core/domain/design/operationGeometry';
import type { WorkSurface } from '@core/domain/design/workSurface';
import type { DesignProjectRepository } from '@core/application/ports/designProjectRepository';

/** Outcome of loading the project at startup. */
export enum DesignProjectLoadStatus {
  Loaded = 'loaded',
  /** Damaged values were replaced or dropped. */
  Recovered = 'recovered',
  /** Storage could not be read: the application starts with an empty project. */
  Failed = 'failed',
}

/** Called on every project change. */
export type DesignProjectListener = (project: DesignProject) => void;

/** Called when writing the project to storage fails. */
export type DesignProjectPersistFailureHandler = (cause: unknown) => void;

/** Depth of a newly drawn operation before the engineer changes it. */
const DEFAULT_DEPTH_IN_PASSES = 1;
/** Limits memory use; nobody undoes hundreds of steps. */
const MAX_UNDO_STEPS = 100;

/**
 * Holds the project being designed.
 * The project is immutable, so undo is simply a stack of earlier versions.
 */
export class DesignProjectService {
  private project: DesignProject = EMPTY_DESIGN_PROJECT;
  private undoStack: readonly DesignProject[] = [];
  private redoStack: readonly DesignProject[] = [];
  private readonly listeners = new Set<DesignProjectListener>();
  private persistFailureHandler: DesignProjectPersistFailureHandler = () => {};
  private pendingWrites: Promise<void> = Promise.resolve();

  /**
   * @param repository - Project storage.
   * @param generateId - Produces unique identifiers for new operations.
   */
  constructor(
    private readonly repository: DesignProjectRepository,
    private readonly generateId: () => string,
  ) {}

  get current(): DesignProject {
    return this.project;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** @returns Function that cancels the subscription. */
  subscribe(listener: DesignProjectListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onPersistFailure(handler: DesignProjectPersistFailureHandler): void {
    this.persistFailureHandler = handler;
  }

  async load(): Promise<DesignProjectLoadStatus> {
    try {
      const { project, wasRecovered } = parseDesignProject(await this.repository.load());
      this.project = project;
      this.notifyListeners();
      return wasRecovered ? DesignProjectLoadStatus.Recovered : DesignProjectLoadStatus.Loaded;
    } catch {
      return DesignProjectLoadStatus.Failed;
    }
  }

  updateSurface(surface: WorkSurface): void {
    this.applyChange({ ...this.project, surface });
  }

  /** Adds a shape drawn with a pointer gesture. */
  drawOperation(kind: DesignOperationKind, start: SheetPoint, end: SheetPoint): DesignOperation {
    const { surface, operations } = this.project;
    const operation = createOperationFromDrawing({
      kind,
      id: this.generateId(),
      start,
      end,
      toolDiameterMm: surface.toolDiameterMm,
      depthMm: Math.min(surface.depthPerPassMm * DEFAULT_DEPTH_IN_PASSES, surface.sheetThicknessMm),
    });
    this.applyChange({ ...this.project, operations: [...operations, operation] });
    return operation;
  }

  updateOperation(operation: DesignOperation): void {
    this.applyChange({
      ...this.project,
      operations: this.project.operations.map((existing) => (existing.id === operation.id ? operation : existing)),
    });
  }

  removeOperation(operationId: string): void {
    this.applyChange({
      ...this.project,
      operations: this.project.operations.filter((operation) => operation.id !== operationId),
    });
  }

  /**
   * Inserts a copy right after the original.
   *
   * @returns The copy, or `null` when the original does not exist.
   */
  duplicateOperation(operationId: string, transform: (copy: DesignOperation) => DesignOperation): DesignOperation | null {
    const operations = [...this.project.operations];
    const index = operations.findIndex((operation) => operation.id === operationId);
    const original = operations[index];
    if (!original) return null;
    const copy = transform({ ...original, id: this.generateId() });
    operations.splice(index + 1, 0, copy);
    this.applyChange({ ...this.project, operations });
    return copy;
  }

  /**
   * Changes the cutting order; moves past either end are ignored.
   *
   * @param positionDelta - Signed number of positions to move by.
   */
  reorderOperation(operationId: string, positionDelta: number): void {
    const operations = [...this.project.operations];
    const sourceIndex = operations.findIndex((operation) => operation.id === operationId);
    const targetIndex = sourceIndex + positionDelta;
    const moved = operations[sourceIndex];
    if (!moved || targetIndex < 0 || targetIndex >= operations.length) return;
    operations.splice(sourceIndex, 1);
    operations.splice(targetIndex, 0, moved);
    this.applyChange({ ...this.project, operations });
  }

  /** Replaces all operations; can be undone like any other change. */
  replaceOperations(buildOperations: (generateId: () => string) => readonly DesignOperation[]): void {
    this.applyChange({ ...this.project, operations: buildOperations(this.generateId) });
  }

  undo(): void {
    const previous = this.undoStack.at(-1);
    if (!previous) return;
    this.redoStack = [...this.redoStack, this.project];
    this.undoStack = this.undoStack.slice(0, -1);
    this.commit(previous);
  }

  redo(): void {
    const next = this.redoStack.at(-1);
    if (!next) return;
    this.undoStack = [...this.undoStack, this.project];
    this.redoStack = this.redoStack.slice(0, -1);
    this.commit(next);
  }

  /** @returns Promise that settles once all started writes have finished. */
  whenPersisted(): Promise<void> {
    return this.pendingWrites;
  }

  private applyChange(project: DesignProject): void {
    this.undoStack = [...this.undoStack, this.project].slice(-MAX_UNDO_STEPS);
    this.redoStack = [];
    this.commit(project);
  }

  private commit(project: DesignProject): void {
    this.project = project;
    this.notifyListeners();
    // Writes are chained: otherwise an older snapshot could overwrite a newer one.
    this.pendingWrites = this.pendingWrites
      .then(() => this.repository.save(project))
      .catch((cause: unknown) => this.persistFailureHandler(cause));
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) listener(this.project);
  }
}
