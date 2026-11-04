import {
  Axis,
  CommandRejectionReason,
  ConnectionFailureReason,
  DiagnosticCode,
  JogButtonValidationError,
  JogDirection,
  JogUnit,
  MachineFaultKind,
  MachineLinkKind,
  MachineStatus,
  formatCoordinate,
  type ConnectionFailure,
  type Diagnostic,
  type DiagnosticDetails,
  type JogButtonDraft,
  type JogRejection,
  type MachineFault,
  type MachineLinkTarget,
  type MachineStateRejection,
  type ProgramRunRejection,
  type TravelLimitRejection,
} from '@rezets/core';

/** All operator-facing text lives here: the core reports codes, and this module gives them words. */

export const MACHINE_STATUS_LABELS: Readonly<Record<MachineStatus, string>> = {
  [MachineStatus.Idle]: 'Готов',
  [MachineStatus.Jogging]: 'Перемещение',
  [MachineStatus.Homing]: 'Возврат в ноль',
  [MachineStatus.RunningProgram]: 'Выполняется программа',
  [MachineStatus.ProgramPaused]: 'Пауза',
  [MachineStatus.Alarm]: 'Авария',
};

export const JOG_UNIT_LABELS: Readonly<Record<JogUnit, string>> = {
  [JogUnit.Millimeter]: 'мм',
  [JogUnit.Centimeter]: 'см',
  [JogUnit.Meter]: 'м',
  [JogUnit.Step]: 'шаг',
};

export const AXIS_LABELS: Readonly<Record<Axis, string>> = {
  [Axis.X]: 'X',
  [Axis.Y]: 'Y',
  [Axis.Z]: 'Z',
};

const JOG_VALIDATION_MESSAGES: Readonly<Record<JogButtonValidationError, string>> = {
  [JogButtonValidationError.LabelRequired]: 'Укажите название',
  [JogButtonValidationError.LabelTooLong]: 'Слишком длинное название',
  [JogButtonValidationError.DistanceNotPositive]: 'Должно быть больше нуля',
  [JogButtonValidationError.DistanceTooLarge]: 'Слишком большое значение',
  [JogButtonValidationError.FeedRateNotPositive]: 'Должна быть больше нуля',
  [JogButtonValidationError.FeedRateTooLarge]: 'Слишком большая подача',
};

export const describeJogValidationError = (error: JogButtonValidationError | undefined): string =>
  error ? JOG_VALIDATION_MESSAGES[error] : '';

const pluralizeSteps = (count: number): string => {
  const lastTwoDigits = Math.abs(count) % 100;
  const lastDigit = lastTwoDigits % 10;
  if (!Number.isInteger(count)) return 'шага';
  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) return 'шагов';
  if (lastDigit === 1) return 'шаг';
  return lastDigit >= 2 && lastDigit <= 4 ? 'шага' : 'шагов';
};

/** Formats a button's distance with its unit, declining the word for steps to agree with the number. */
export function formatJogDistance(button: Pick<JogButtonDraft, 'distance' | 'unit'>): string {
  const unitLabel = button.unit === JogUnit.Step ? pluralizeSteps(button.distance) : JOG_UNIT_LABELS[button.unit];
  return `${formatCoordinate(button.distance)} ${unitLabel}`;
}

/** Formats a button's axis and direction, such as `Y+`. */
export const formatJogAxis = (button: Pick<JogButtonDraft, 'axis' | 'direction'>): string =>
  `${AXIS_LABELS[button.axis]}${button.direction === JogDirection.Positive ? '+' : '−'}`;

const DIAGNOSTIC_MESSAGES: Readonly<Record<DiagnosticCode, (details: DiagnosticDetails) => string>> = {
  [DiagnosticCode.UnterminatedComment]: () => 'Комментарий не закрыт скобкой «)»',
  [DiagnosticCode.MissingNumber]: ({ character }) => `После адреса «${character}» ожидается число`,
  [DiagnosticCode.UnexpectedCharacter]: ({ character }) => `Неожиданный символ «${character}»`,
  [DiagnosticCode.DuplicateWord]: ({ character }) => `Адрес «${character}» указан дважды, используется последнее значение`,
  [DiagnosticCode.InvalidFeedRate]: () => 'Подача F должна быть больше нуля',
  [DiagnosticCode.MissingFeedRate]: () => 'Подача F не задана: будет использована подача по умолчанию',
  [DiagnosticCode.MissingMotionMode]: () => 'Координаты указаны, но режим движения (G0, G1, G2, G3) не выбран',
  [DiagnosticCode.UnsupportedCommand]: ({ word }) => `Команда ${word} не поддерживается и пропущена`,
  [DiagnosticCode.UnsupportedAxis]: ({ character }) => `Ось ${character} не поддерживается: движение по ней не показывается и не попадёт в экспорт`,
  [DiagnosticCode.CutterCompensationIgnored]: ({ word }) => `Коррекция на радиус ${word} не учитывается в предпросмотре`,
  [DiagnosticCode.MachineCoordinatesApproximated]: () => 'G53: машинные координаты показаны как рабочие',
  [DiagnosticCode.CodeAfterProgramEnd]: () => 'Код после конца программы (M2, M30) не выполняется',
  [DiagnosticCode.ArcMissingParameters]: () => 'Для дуги нужен радиус R или центр I, J, K. Показана прямая линия',
  [DiagnosticCode.ArcZeroRadius]: () => 'Радиус дуги равен нулю. Показана прямая линия',
  [DiagnosticCode.ArcRadiusMismatch]: ({ startRadiusMm, endRadiusMm }) =>
    `Начало и конец дуги лежат на разных радиусах (${formatCoordinate(startRadiusMm ?? 0)} и ${formatCoordinate(endRadiusMm ?? 0)} мм). Показана прямая линия`,
  [DiagnosticCode.ArcRadiusTooSmall]: ({ radiusMm, halfChordMm }) =>
    `Радиус ${formatCoordinate(radiusMm ?? 0)} мм меньше половины расстояния между точками (${formatCoordinate(halfChordMm ?? 0)} мм). Показана прямая линия`,
  [DiagnosticCode.ArcFullCircleByRadius]: () => 'Полную окружность нельзя задать через R, используйте I, J, K. Показана прямая линия',
  [DiagnosticCode.ArcRadiusAndCenterConflict]: () => 'В дуге заданы и R, и центр: используется центр',
  [DiagnosticCode.DrillCycleMissingParameters]: () => 'Для цикла сверления нужны адреса Z и R',
  [DiagnosticCode.DrillCycleIncrementalUnsupported]: () => 'Циклы сверления в режиме G91 не показываются в предпросмотре',
};

export const describeDiagnostic = (diagnostic: Diagnostic): string =>
  DIAGNOSTIC_MESSAGES[diagnostic.code](diagnostic.details);

const describeLimitViolation = ({ violation }: TravelLimitRejection): string =>
  `Выход за пределы станка по оси ${AXIS_LABELS[violation.axis]}: ${formatCoordinate(violation.value)} мм при допустимых ` +
  `${formatCoordinate(violation.limit.min)}…${formatCoordinate(violation.limit.max)} мм`;

function describeStateRejection(rejection: MachineStateRejection): string {
  return rejection.reason === CommandRejectionReason.MachineBusy
    ? 'Станок занят: дождитесь окончания движения'
    : 'Авария: сначала снимите блокировку';
}

export const describeJogRejection = (rejection: JogRejection): string =>
  rejection.reason === CommandRejectionReason.OutOfTravelLimits
    ? describeLimitViolation(rejection)
    : describeStateRejection(rejection);

export function describeRunRejection(rejection: ProgramRunRejection): string {
  switch (rejection.reason) {
    case CommandRejectionReason.ProgramHasErrors:
      return 'В программе есть ошибки: исправьте их перед запуском';
    case CommandRejectionReason.ProgramIsEmpty:
      return 'В программе нет движений';
    case CommandRejectionReason.OutOfTravelLimits:
      return describeLimitViolation(rejection);
    case CommandRejectionReason.MachineBusy:
    case CommandRejectionReason.MachineInAlarm:
      return describeStateRejection(rejection);
  }
}

export function describeFault(fault: MachineFault): string {
  switch (fault.kind) {
    case MachineFaultKind.CommandRejected:
      return `Контроллер отклонил команду (код ошибки ${fault.controllerCode})`;
    case MachineFaultKind.ControllerAlarm:
      return `Авария контроллера (код ${fault.controllerCode})`;
    case MachineFaultKind.ConnectionLost:
      return 'Связь со станком потеряна';
  }
}

export function describeConnectionFailure(failure: ConnectionFailure): string {
  switch (failure.reason) {
    case ConnectionFailureReason.MachineBusy:
      return 'Станок занят: дождитесь окончания движения';
    case ConnectionFailureReason.LinkFailed:
      return `Не удалось подключиться: ${failure.systemMessage ?? 'неизвестная ошибка'}`;
    case ConnectionFailureReason.ControllerNotResponding:
      return 'Контроллер не отвечает. Проверьте порт, скорость и что на станке прошивка GRBL';
  }
}

export const describeLinkTarget = (target: MachineLinkTarget): string =>
  target.kind === MachineLinkKind.Serial ? target.portPath : `${target.host}:${target.port}`;
