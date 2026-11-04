import type { AppSettings } from '@core/domain/settings/appSettings';

/** Output port for persisting settings. */
export interface SettingsRepository {
  /** @returns The raw stored value, untrusted; `null` when settings were never saved. */
  load(): Promise<unknown>;
  save(settings: AppSettings): Promise<void>;
}
