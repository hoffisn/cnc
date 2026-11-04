import { Axis } from '@core/domain/geometry/vector3';
import { err, ok, type Result } from '@core/domain/shared/result';

/** Unit a jog button's distance is expressed in. */
export enum JogUnit {
  Millimeter = 'mm',
  Centimeter = 'cm',
  Meter = 'm',
  /** Size is defined by {@link MachineSettings.stepSizeMm}. */
  Step = 'step',
}

/** Sign of a jog movement along its axis. */
export enum JogDirection {
  Positive = 1,
  Negative = -1,
}

/** Operator-configurable movement button, such as "Forward 1 m" or "Back 5 steps". */
export interface JogButton {
  readonly id: string;
  readonly label: string;
  readonly axis: Axis;
  readonly direction: JogDirection;
  /** Distance in {@link JogButton.unit}, always positive. */
  readonly distance: number;
  readonly unit: JogUnit;
  /** Speed of the movement, in mm/min. */
  readonly feedRate: number;
}

/** Jog button parameters before it is assigned an identity. */
export type JogButtonDraft = Omit<JogButton, 'id'>;

/** Reason a jog button field was rejected. */
export enum JogButtonValidationError {
  LabelRequired = 'label-required',
  LabelTooLong = 'label-too-long',
  DistanceNotPositive = 'distance-not-positive',
  DistanceTooLarge = 'distance-too-large',
  FeedRateNotPositive = 'feed-rate-not-positive',
  FeedRateTooLarge = 'feed-rate-too-large',
}

/** Validation errors per field; a missing field is valid. */
export interface JogButtonFieldErrors {
  readonly label?: JogButtonValidationError;
  readonly distance?: JogButtonValidationError;
  readonly feedRate?: JogButtonValidationError;
}

/** Longest label that still fits on a button. */
export const JOG_LABEL_MAX_LENGTH = 24;
/** Largest accepted jog distance, in the button's own unit. */
export const JOG_DISTANCE_MAX = 100000;
/** Largest accepted jog feed rate, in mm/min. */
export const JOG_FEED_RATE_MAX = 100000;

const MILLIMETERS_PER_UNIT: Readonly<Record<Exclude<JogUnit, JogUnit.Step>, number>> = {
  [JogUnit.Millimeter]: 1,
  [JogUnit.Centimeter]: 10,
  [JogUnit.Meter]: 1000,
};

/**
 * Computes the signed displacement a button commands.
 *
 * @param stepSizeMm - Millimeters in one step, see {@link MachineSettings.stepSizeMm}.
 * @returns Displacement along the button's axis, in millimeters.
 */
export function computeJogDisplacementMm(button: JogButtonDraft, stepSizeMm: number): number {
  const unitSizeMm = button.unit === JogUnit.Step ? stepSizeMm : MILLIMETERS_PER_UNIT[button.unit];
  return button.direction * button.distance * unitSizeMm;
}

function validatePositiveLimited(
  value: number,
  maximum: number,
  notPositiveError: JogButtonValidationError,
  tooLargeError: JogButtonValidationError,
): JogButtonValidationError | undefined {
  if (!Number.isFinite(value) || value <= 0) return notPositiveError;
  return value > maximum ? tooLargeError : undefined;
}

/** Checks a draft and normalizes its label. */
export function validateJogButtonDraft(draft: JogButtonDraft): Result<JogButtonDraft, JogButtonFieldErrors> {
  const label = draft.label.trim();
  let labelError: JogButtonValidationError | undefined;
  if (label.length === 0) labelError = JogButtonValidationError.LabelRequired;
  else if (label.length > JOG_LABEL_MAX_LENGTH) labelError = JogButtonValidationError.LabelTooLong;

  const distanceError = validatePositiveLimited(
    draft.distance,
    JOG_DISTANCE_MAX,
    JogButtonValidationError.DistanceNotPositive,
    JogButtonValidationError.DistanceTooLarge,
  );
  const feedRateError = validatePositiveLimited(
    draft.feedRate,
    JOG_FEED_RATE_MAX,
    JogButtonValidationError.FeedRateNotPositive,
    JogButtonValidationError.FeedRateTooLarge,
  );

  if (labelError || distanceError || feedRateError) {
    return err({
      ...(labelError && { label: labelError }),
      ...(distanceError && { distance: distanceError }),
      ...(feedRateError && { feedRate: feedRateError }),
    });
  }
  return ok({ ...draft, label });
}

/** Button set of a fresh installation. Labels are seed data for the Russian-speaking target market. */
export const DEFAULT_JOG_BUTTONS: readonly JogButton[] = [
  { id: 'forward-1-m', label: 'Вперёд', axis: Axis.Y, direction: JogDirection.Positive, distance: 1, unit: JogUnit.Meter, feedRate: 6000 },
  { id: 'back-5-m', label: 'Назад', axis: Axis.Y, direction: JogDirection.Negative, distance: 5, unit: JogUnit.Meter, feedRate: 6000 },
  { id: 'left-100-mm', label: 'Влево', axis: Axis.X, direction: JogDirection.Negative, distance: 100, unit: JogUnit.Millimeter, feedRate: 3000 },
  { id: 'right-100-mm', label: 'Вправо', axis: Axis.X, direction: JogDirection.Positive, distance: 100, unit: JogUnit.Millimeter, feedRate: 3000 },
  { id: 'up-10-mm', label: 'Вверх', axis: Axis.Z, direction: JogDirection.Positive, distance: 10, unit: JogUnit.Millimeter, feedRate: 1000 },
  { id: 'down-10-mm', label: 'Вниз', axis: Axis.Z, direction: JogDirection.Negative, distance: 10, unit: JogUnit.Millimeter, feedRate: 1000 },
  { id: 'forward-5-steps', label: 'Вперёд', axis: Axis.Y, direction: JogDirection.Positive, distance: 5, unit: JogUnit.Step, feedRate: 1000 },
  { id: 'back-5-steps', label: 'Назад', axis: Axis.Y, direction: JogDirection.Negative, distance: 5, unit: JogUnit.Step, feedRate: 1000 },
];
