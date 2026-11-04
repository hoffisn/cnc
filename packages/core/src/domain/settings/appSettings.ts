import { Axis } from '@core/domain/geometry/vector3';
import {
  DEFAULT_JOG_BUTTONS,
  JogDirection,
  JogUnit,
  validateJogButtonDraft,
  type JogButton,
} from '@core/domain/machine/jogButton';
import {
  DEFAULT_MACHINE_SETTINGS,
  type AxisTravelLimit,
  type MachineSettings,
  type TravelLimits,
} from '@core/domain/machine/machineSettings';

/** Current schema of persisted settings. */
export const SETTINGS_SCHEMA_VERSION = 1;

/** Everything the application persists between launches. */
export interface AppSettings {
  readonly schemaVersion: number;
  readonly jogButtons: readonly JogButton[];
  readonly machine: MachineSettings;
}

/** Settings of a fresh installation. */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  jogButtons: DEFAULT_JOG_BUTTONS,
  machine: DEFAULT_MACHINE_SETTINGS,
};

/** Result of reading settings from untrusted storage. */
export interface ParsedAppSettings {
  readonly settings: AppSettings;
  /** Some stored values were damaged and got replaced with defaults. */
  readonly wasRecovered: boolean;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const isEnumValue = <TEnum extends string | number>(
  enumObject: Readonly<Record<string, TEnum | string>>,
  value: unknown,
): value is TEnum => Object.values(enumObject).includes(value as TEnum);

function parseJogButton(value: unknown): JogButton | null {
  if (!isRecord(value)) return null;
  const { id, label, axis, direction, distance, unit, feedRate } = value;
  if (typeof id !== 'string' || id.length === 0 || typeof label !== 'string') return null;
  if (!isEnumValue<Axis>(Axis, axis) || !isEnumValue<JogUnit>(JogUnit, unit)) return null;
  if (direction !== JogDirection.Positive && direction !== JogDirection.Negative) return null;
  if (typeof distance !== 'number' || typeof feedRate !== 'number') return null;

  const validation = validateJogButtonDraft({ label, axis, direction, distance, unit, feedRate });
  return validation.ok ? { id, ...validation.value } : null;
}

function parseTravelLimit(value: unknown): AxisTravelLimit | null {
  if (!isRecord(value)) return null;
  const { min, max } = value;
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) return null;
  return { min, max };
}

/**
 * Reads settings loaded from disk.
 * The file may be damaged or hand-edited, so each field is checked separately:
 * a bad one falls back to its default while all good ones are preserved.
 *
 * @param stored - Raw stored value; `null` or `undefined` means settings were never saved.
 */
export function parseAppSettings(stored: unknown): ParsedAppSettings {
  if (stored === null || stored === undefined) return { settings: DEFAULT_APP_SETTINGS, wasRecovered: false };
  if (!isRecord(stored)) return { settings: DEFAULT_APP_SETTINGS, wasRecovered: true };

  let wasRecovered = false;

  let jogButtons: readonly JogButton[] = DEFAULT_JOG_BUTTONS;
  if (Array.isArray(stored.jogButtons)) {
    const knownIds = new Set<string>();
    const validButtons: JogButton[] = [];
    for (const storedButton of stored.jogButtons as readonly unknown[]) {
      const button = parseJogButton(storedButton);
      if (button && !knownIds.has(button.id)) {
        knownIds.add(button.id);
        validButtons.push(button);
      } else {
        wasRecovered = true;
      }
    }
    jogButtons = validButtons;
  } else {
    wasRecovered = true;
  }

  const storedMachine: UnknownRecord = isRecord(stored.machine) ? stored.machine : {};
  const storedLimits: UnknownRecord = isRecord(storedMachine.travelLimits) ? storedMachine.travelLimits : {};
  if (!isRecord(stored.machine)) wasRecovered = true;

  const positiveOrDefault = (value: unknown, defaultValue: number): number => {
    if (isPositiveNumber(value)) return value;
    wasRecovered = true;
    return defaultValue;
  };
  const limitOrDefault = (axis: Axis): AxisTravelLimit => {
    const limit = parseTravelLimit(storedLimits[axis]);
    if (limit) return limit;
    wasRecovered = true;
    return DEFAULT_MACHINE_SETTINGS.travelLimits[axis];
  };
  const travelLimits: TravelLimits = {
    [Axis.X]: limitOrDefault(Axis.X),
    [Axis.Y]: limitOrDefault(Axis.Y),
    [Axis.Z]: limitOrDefault(Axis.Z),
  };

  return {
    settings: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      jogButtons,
      machine: {
        stepSizeMm: positiveOrDefault(storedMachine.stepSizeMm, DEFAULT_MACHINE_SETTINGS.stepSizeMm),
        travelLimits,
        rapidFeedRate: positiveOrDefault(storedMachine.rapidFeedRate, DEFAULT_MACHINE_SETTINGS.rapidFeedRate),
        defaultFeedRate: positiveOrDefault(storedMachine.defaultFeedRate, DEFAULT_MACHINE_SETTINGS.defaultFeedRate),
        toolDiameter: positiveOrDefault(storedMachine.toolDiameter, DEFAULT_MACHINE_SETTINGS.toolDiameter),
      },
    },
    wasRecovered,
  };
}
