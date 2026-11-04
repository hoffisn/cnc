import { describe, expect, it } from 'vitest';
import { Axis } from '@core/domain/geometry/vector3';
import {
  JogButtonValidationError,
  JogDirection,
  JogUnit,
  computeJogDisplacementMm,
  validateJogButtonDraft,
  type JogButtonDraft,
} from '@core/domain/machine/jogButton';
import { DEFAULT_MACHINE_SETTINGS, findPointViolation } from '@core/domain/machine/machineSettings';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '@core/domain/settings/appSettings';
import {
  IDENTITY_SCALE,
  MAX_SCALE_FACTOR,
  MIN_SCALE_FACTOR,
  setAxisScaleFactor,
  setAxisTargetSize,
} from '@core/domain/transform/scaleTransform';

const forwardOneMeter: JogButtonDraft = {
  label: 'Forward',
  axis: Axis.Y,
  direction: JogDirection.Positive,
  distance: 1,
  unit: JogUnit.Meter,
  feedRate: 1000,
};

describe('jog buttons', () => {
  it('convert units to signed millimeters', () => {
    expect(computeJogDisplacementMm(forwardOneMeter, 1)).toBe(1000);
    expect(
      computeJogDisplacementMm({ ...forwardOneMeter, unit: JogUnit.Centimeter, direction: JogDirection.Negative, distance: 5 }, 1),
    ).toBe(-50);
    expect(computeJogDisplacementMm({ ...forwardOneMeter, unit: JogUnit.Millimeter, distance: 7 }, 1)).toBe(7);
    expect(computeJogDisplacementMm({ ...forwardOneMeter, unit: JogUnit.Step, distance: 5 }, 0.5)).toBe(2.5);
  });

  it('trim the label on validation', () => {
    expect(validateJogButtonDraft({ ...forwardOneMeter, label: '  Step  ' })).toMatchObject({ ok: true, value: { label: 'Step' } });
  });

  it('report an error per invalid field', () => {
    expect(validateJogButtonDraft({ ...forwardOneMeter, label: ' ', distance: 0, feedRate: Number.NaN })).toEqual({
      ok: false,
      error: {
        label: JogButtonValidationError.LabelRequired,
        distance: JogButtonValidationError.DistanceNotPositive,
        feedRate: JogButtonValidationError.FeedRateNotPositive,
      },
    });
  });

});

describe('travel limits', () => {
  const limits = DEFAULT_MACHINE_SETTINGS.travelLimits;

  it('allow the boundary and report the violated axis beyond it', () => {
    expect(findPointViolation({ x: limits.x.max, y: 0, z: 0 }, limits)).toBeNull();
    expect(findPointViolation({ x: 0, y: 0, z: limits.z.min - 1 }, limits)?.axis).toBe(Axis.Z);
  });
});

describe('scaling', () => {
  it('changes only the chosen axis without keeping proportions', () => {
    expect(setAxisScaleFactor(IDENTITY_SCALE, Axis.X, 2, false)).toEqual({ x: 2, y: 1, z: 1 });
  });

  it('applies one ratio to all axes when keeping proportions', () => {
    expect(setAxisScaleFactor({ x: 2, y: 1, z: 0.5 }, Axis.X, 4, true)).toEqual({ x: 4, y: 2, z: 1 });
  });

  it('preserves proportions when an axis hits a limit', () => {
    const stretched = setAxisScaleFactor({ x: 1, y: 50, z: 1 }, Axis.X, 10, true);
    expect(stretched.y).toBe(MAX_SCALE_FACTOR);
    expect(stretched.x).toBeCloseTo(2);
    expect(stretched.z).toBeCloseTo(2);
    const shrunk = setAxisScaleFactor({ x: 1, y: 0.1, z: 1 }, Axis.X, 0.001, true);
    expect(shrunk.y).toBeCloseTo(MIN_SCALE_FACTOR);
    expect(shrunk.x).toBeCloseTo(0.1);
  });

  it('ignores invalid factors', () => {
    for (const invalidFactor of [0, -1, Number.NaN, Infinity]) {
      expect(setAxisScaleFactor(IDENTITY_SCALE, Axis.X, invalidFactor, false)).toBe(IDENTITY_SCALE);
    }
  });

  it('derives the factor from a target size and refuses to stretch a zero size', () => {
    expect(setAxisTargetSize(IDENTITY_SCALE, Axis.X, 50, 200, false).x).toBe(4);
    expect(setAxisTargetSize(IDENTITY_SCALE, Axis.Z, 0, 200, false)).toBe(IDENTITY_SCALE);
  });
});

describe('parseAppSettings', () => {
  it('uses defaults silently when nothing was stored', () => {
    expect(parseAppSettings(null)).toEqual({ settings: DEFAULT_APP_SETTINGS, wasRecovered: false });
  });

  it('reads saved settings without loss', () => {
    expect(parseAppSettings(JSON.parse(JSON.stringify(DEFAULT_APP_SETTINGS)))).toEqual({
      settings: DEFAULT_APP_SETTINGS,
      wasRecovered: false,
    });
  });

  it('accepts an empty button list as a legitimate user choice', () => {
    const { settings, wasRecovered } = parseAppSettings({ ...DEFAULT_APP_SETTINGS, jogButtons: [] });
    expect(settings.jogButtons).toEqual([]);
    expect(wasRecovered).toBe(false);
  });

  it('replaces damaged fields and keeps good ones', () => {
    const validButton = { ...forwardOneMeter, id: 'valid-button' };
    const { settings, wasRecovered } = parseAppSettings({
      jogButtons: [validButton, { id: 'damaged-button', label: 5 }, validButton],
      machine: { stepSizeMm: -1, rapidFeedRate: 500, travelLimits: { x: { min: 5, max: 1 } } },
    });
    expect(wasRecovered).toBe(true);
    expect(settings.jogButtons).toEqual([validButton]);
    expect(settings.machine.rapidFeedRate).toBe(500);
    expect(settings.machine.stepSizeMm).toBe(DEFAULT_MACHINE_SETTINGS.stepSizeMm);
    expect(settings.machine.travelLimits.x).toEqual(DEFAULT_MACHINE_SETTINGS.travelLimits.x);
  });

  it('rejects unknown enum values in a stored button', () => {
    const { settings } = parseAppSettings({
      ...DEFAULT_APP_SETTINGS,
      jogButtons: [{ ...forwardOneMeter, id: 'bad-axis', axis: 'q' }, { ...forwardOneMeter, id: 'bad-direction', direction: 2 }],
    });
    expect(settings.jogButtons).toEqual([]);
  });

  it('does not crash on values of a wrong type', () => {
    for (const malformedValue of ['text', 5, [], true]) {
      expect(parseAppSettings(malformedValue)).toEqual({ settings: DEFAULT_APP_SETTINGS, wasRecovered: true });
    }
  });
});
