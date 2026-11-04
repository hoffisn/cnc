import {
  DEFAULT_JOG_BUTTONS,
  validateJogButtonDraft,
  type JogButton,
  type JogButtonDraft,
  type JogButtonFieldErrors,
} from '@core/domain/machine/jogButton';
import type { MachineSettings } from '@core/domain/machine/machineSettings';
import { DEFAULT_APP_SETTINGS, parseAppSettings, type AppSettings } from '@core/domain/settings/appSettings';
import { err, ok, type Result } from '@core/domain/shared/result';
import type { SettingsRepository } from '@core/application/ports/settingsRepository';

/** Outcome of loading settings at startup. */
export enum SettingsLoadStatus {
  Loaded = 'loaded',
  /** Damaged values were replaced with defaults. */
  Recovered = 'recovered',
  /** Storage could not be read: the application runs on defaults. */
  Failed = 'failed',
}

/** Called on every settings change. */
export type SettingsListener = (settings: AppSettings) => void;

/** Called when writing settings to storage fails. */
export type SettingsPersistFailureHandler = (cause: unknown) => void;

/** Holds the settings and guarantees that every change is validated and persisted. */
export class SettingsService {
  private settings: AppSettings = DEFAULT_APP_SETTINGS;
  private readonly listeners = new Set<SettingsListener>();
  private persistFailureHandler: SettingsPersistFailureHandler = () => {};
  private pendingWrites: Promise<void> = Promise.resolve();

  /**
   * @param repository - Settings storage.
   * @param generateId - Produces unique identifiers for new jog buttons.
   */
  constructor(
    private readonly repository: SettingsRepository,
    private readonly generateId: () => string,
  ) {}

  get current(): AppSettings {
    return this.settings;
  }

  /** @returns Function that cancels the subscription. */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onPersistFailure(handler: SettingsPersistFailureHandler): void {
    this.persistFailureHandler = handler;
  }

  async load(): Promise<SettingsLoadStatus> {
    try {
      const { settings, wasRecovered } = parseAppSettings(await this.repository.load());
      this.settings = settings;
      this.notifyListeners();
      return wasRecovered ? SettingsLoadStatus.Recovered : SettingsLoadStatus.Loaded;
    } catch {
      return SettingsLoadStatus.Failed;
    }
  }

  /**
   * Validates and stores a jog button.
   *
   * @param buttonId - Button to replace; `null` adds a new button.
   */
  saveJogButton(draft: JogButtonDraft, buttonId: string | null): Result<JogButton, JogButtonFieldErrors> {
    const validation = validateJogButtonDraft(draft);
    if (!validation.ok) return err(validation.error);

    const buttons = this.settings.jogButtons;
    const existingId = buttons.find((button) => button.id === buttonId)?.id;
    const savedButton: JogButton = { ...validation.value, id: existingId ?? this.generateId() };
    this.applyChange({
      jogButtons: existingId
        ? buttons.map((button) => (button.id === existingId ? savedButton : button))
        : [...buttons, savedButton],
    });
    return ok(savedButton);
  }

  removeJogButton(buttonId: string): void {
    this.applyChange({ jogButtons: this.settings.jogButtons.filter((button) => button.id !== buttonId) });
  }

  /**
   * Moves a button within the list; moves past either end are ignored.
   *
   * @param positionDelta - Signed number of positions to move by.
   */
  moveJogButton(buttonId: string, positionDelta: number): void {
    const buttons = [...this.settings.jogButtons];
    const sourceIndex = buttons.findIndex((button) => button.id === buttonId);
    const targetIndex = sourceIndex + positionDelta;
    const movedButton = buttons[sourceIndex];
    if (!movedButton || targetIndex < 0 || targetIndex >= buttons.length) return;
    buttons.splice(sourceIndex, 1);
    buttons.splice(targetIndex, 0, movedButton);
    this.applyChange({ jogButtons: buttons });
  }

  resetJogButtons(): void {
    this.applyChange({ jogButtons: DEFAULT_JOG_BUTTONS });
  }

  updateMachineSettings(machine: MachineSettings): void {
    this.applyChange({ machine });
  }

  /** @returns Promise that settles once all started writes have finished. */
  whenPersisted(): Promise<void> {
    return this.pendingWrites;
  }

  private applyChange(change: Partial<AppSettings>): void {
    this.settings = { ...this.settings, ...change };
    this.notifyListeners();
    // Writes are chained: otherwise an older snapshot could overwrite a newer one.
    const snapshot = this.settings;
    this.pendingWrites = this.pendingWrites
      .then(() => this.repository.save(snapshot))
      .catch((cause: unknown) => this.persistFailureHandler(cause));
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) listener(this.settings);
  }
}
