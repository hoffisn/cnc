import { describe, expect, it } from 'vitest';
import { DesignProjectLoadStatus, DesignProjectService } from '@core/application/designProjectService';
import { DesignOperationKind } from '@core/domain/design/designOperation';
import type { DesignProject } from '@core/domain/design/designProject';

function createService(storedValue: unknown = null) {
  const saved: DesignProject[] = [];
  let generatedCount = 0;
  const service = new DesignProjectService(
    {
      load: async () => storedValue,
      save: async (project) => {
        saved.push(project);
      },
    },
    () => `generated-${(generatedCount += 1)}`,
  );
  return { service, saved };
}

const POINT = { x: 50, y: 50 };
const operationIds = (service: DesignProjectService): string[] => service.current.operations.map((operation) => operation.id);

describe('DesignProjectService', () => {
  it('draws, reorders, duplicates and removes operations, persisting each change', async () => {
    const { service, saved } = createService();
    service.drawOperation(DesignOperationKind.Hole, POINT, POINT);
    service.drawOperation(DesignOperationKind.Hole, POINT, POINT);
    expect(operationIds(service)).toEqual(['generated-1', 'generated-2']);

    service.reorderOperation('generated-2', -1);
    expect(operationIds(service)).toEqual(['generated-2', 'generated-1']);
    service.reorderOperation('generated-2', -1);
    expect(operationIds(service)).toEqual(['generated-2', 'generated-1']);

    expect(service.duplicateOperation('generated-2', (copy) => copy)?.id).toBe('generated-3');
    expect(operationIds(service)).toEqual(['generated-2', 'generated-3', 'generated-1']);

    service.removeOperation('generated-3');
    expect(operationIds(service)).toEqual(['generated-2', 'generated-1']);

    await service.whenPersisted();
    expect(saved.at(-1)).toEqual(service.current);
  });

  it('never makes a new shape deeper than the sheet', () => {
    const { service } = createService();
    service.updateSurface({ ...service.current.surface, sheetThicknessMm: 2, depthPerPassMm: 3 });
    expect(service.drawOperation(DesignOperationKind.Hole, POINT, POINT).depthMm).toBe(2);
  });

  it('undoes and redoes changes, and a new change discards the redo history', () => {
    const { service } = createService();
    expect(service.canUndo).toBe(false);
    service.drawOperation(DesignOperationKind.Hole, POINT, POINT);
    service.drawOperation(DesignOperationKind.Hole, POINT, POINT);

    service.undo();
    expect(operationIds(service)).toEqual(['generated-1']);
    expect(service.canRedo).toBe(true);
    service.redo();
    expect(operationIds(service)).toEqual(['generated-1', 'generated-2']);

    service.undo();
    service.drawOperation(DesignOperationKind.Hole, POINT, POINT);
    expect(service.canRedo).toBe(false);
  });

  it('persists undone state, so a restart does not bring back what was undone', async () => {
    const { service, saved } = createService();
    service.drawOperation(DesignOperationKind.Hole, POINT, POINT);
    service.undo();
    await service.whenPersisted();
    expect(saved.at(-1)?.operations).toEqual([]);
  });

  it('reports each load outcome', async () => {
    expect(await createService().service.load()).toBe(DesignProjectLoadStatus.Loaded);
    expect(await createService('damaged').service.load()).toBe(DesignProjectLoadStatus.Recovered);
    const failing = new DesignProjectService({ load: () => Promise.reject(new Error('disk')), save: async () => {} }, () => 'id');
    expect(await failing.load()).toBe(DesignProjectLoadStatus.Failed);
  });

  it('reports a write failure and keeps working', async () => {
    const failures: unknown[] = [];
    const service = new DesignProjectService({ load: async () => null, save: () => Promise.reject(new Error('disk')) }, () => 'id');
    service.onPersistFailure((cause) => failures.push(cause));
    service.drawOperation(DesignOperationKind.Hole, POINT, POINT);
    await service.whenPersisted();
    expect(failures).toHaveLength(1);
    expect(service.current.operations).toHaveLength(1);
  });
});
