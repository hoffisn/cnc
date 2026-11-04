import type { DesignProject } from '@core/domain/design/designProject';

/** Output port for persisting the engineer's project. */
export interface DesignProjectRepository {
  /** @returns The raw stored value, untrusted; `null` when no project was saved yet. */
  load(): Promise<unknown>;
  save(project: DesignProject): Promise<void>;
}
