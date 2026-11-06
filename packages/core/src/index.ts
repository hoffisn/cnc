/**
 * Public API of the core: the domain model and use cases of Rezets.
 * Free of UI and platform dependencies, it is shared by the desktop and mobile applications.
 *
 * @packageDocumentation
 */

// Domain: shared kernel
export { ok, err, type Result } from '@core/domain/shared/result';
export { ALL_AXES, Axis, ORIGIN, type Vector3 } from '@core/domain/geometry/vector3';
export { boundsCenter, boundsSize, type Bounds } from '@core/domain/geometry/bounds';

// Domain: G-code
export {
  ArcPlane,
  ProgramStepKind,
  hasProgramErrors,
  type ArcMove,
  type AuxiliaryStep,
  type GCodeProgram,
  type LinearMove,
  type MotionStep,
  type ProgramStep,
} from '@core/domain/gcode/program';
export {
  DiagnosticCode,
  DiagnosticSeverity,
  type Diagnostic,
  type DiagnosticDetails,
} from '@core/domain/gcode/diagnostics';
export { parseGCode } from '@core/domain/gcode/parser';
export { formatCoordinate, generateGCode, generateGCodeBlocks, type GeneratedBlock } from '@core/domain/gcode/generator';

// Domain: figure
export {
  IDENTITY_SCALE,
  MAX_SCALE_FACTOR,
  MIN_SCALE_FACTOR,
  isIdentityScale,
  setAxisScaleFactor,
  setAxisTargetSize,
  type ScaleTransform,
} from '@core/domain/transform/scaleTransform';
export {
  COORDINATES_PER_SEGMENT,
  SegmentKind,
  buildToolpath,
  findLastSegmentUpToLine,
  type Toolpath,
} from '@core/domain/toolpath/toolpath';
export { computeRelief, type Relief, type ReliefOptions, type ReliefStock } from '@core/domain/toolpath/relief';

// Domain: machine
export {
  DEFAULT_JOG_BUTTONS,
  JOG_LABEL_MAX_LENGTH,
  JogButtonValidationError,
  JogDirection,
  JogUnit,
  computeJogDisplacementMm,
  validateJogButtonDraft,
  type JogButton,
  type JogButtonDraft,
  type JogButtonFieldErrors,
} from '@core/domain/machine/jogButton';
export {
  DEFAULT_MACHINE_SETTINGS,
  findBoundsViolation,
  findPointViolation,
  type AxisTravelLimit,
  type MachineSettings,
  type TravelLimitViolation,
  type TravelLimits,
} from '@core/domain/machine/machineSettings';
export { DEFAULT_APP_SETTINGS, parseAppSettings, type AppSettings } from '@core/domain/settings/appSettings';

// Domain: design
export {
  DEFAULT_WORK_SURFACE,
  LengthUnit,
  MILLIMETERS_PER_LENGTH_UNIT,
  ZeroOrigin,
  describeSheetStock,
  findZeroOnSheet,
  type WorkSurface,
} from '@core/domain/design/workSurface';
export {
  DEFAULT_HOLDING_TABS,
  DesignOperationKind,
  NO_HOLDING_TABS,
  ToolSide,
  type CircleOutlineOperation,
  type HoldingTabs,
  type CirclePocketOperation,
  type DesignOperation,
  type HoleGridOperation,
  type HoleOperation,
  type RectangleOutlineOperation,
  type RectanglePocketOperation,
  type SheetPoint,
  type SlotOperation,
} from '@core/domain/design/designOperation';
export {
  OperationHandleKind,
  computeCutFootprint,
  createOperationFromDrawing,
  dragOperationHandle,
  listOperationHandles,
  translateOperation,
  type OperationHandle,
  type SheetRectangle,
} from '@core/domain/design/operationGeometry';
export { EMPTY_DESIGN_PROJECT, parseDesignProject, type DesignProject } from '@core/domain/design/designProject';
export { DesignIssueCode, findDesignIssues, type DesignIssue } from '@core/domain/design/designRules';
export { generateDesignGCode } from '@core/domain/design/designGenerator';
export {
  CUTTING_TOOL_PRESETS,
  StockMaterial,
  findCuttingToolPreset,
  recommendCuttingParameters,
  type CuttingParameters,
  type CuttingToolPreset,
} from '@core/domain/design/cuttingLibrary';
export { areHoldingTabsActive, locateOperationTabs } from '@core/domain/design/designContours';

// Application: ports
export type { Clock } from '@core/application/ports/clock';
export {
  MachineConnectionKind,
  MachineFaultKind,
  MachineStatus,
  type MachineController,
  type MachineFault,
  type MachineState,
  type MachineStateListener,
  type ProgramRunProgress,
  type ProgramRunRequest,
} from '@core/application/ports/machineController';
export {
  OpenProgramStatus,
  ProgramFileLocation,
  SaveProgramStatus,
  type OpenProgramResult,
  type ProgramFile,
  type ProgramFileGateway,
  type SaveProgramResult,
} from '@core/application/ports/programFileGateway';
export {
  MachineLinkKind,
  type MachineLink,
  type MachineLinkProvider,
  type MachineLinkTarget,
  type SerialLinkTarget,
  type SerialPortInfo,
  type TcpLinkTarget,
} from '@core/application/ports/machineLink';
export type { SettingsRepository } from '@core/application/ports/settingsRepository';

export type { DesignProjectRepository } from '@core/application/ports/designProjectRepository';

// Application: use cases
export { DesignProjectLoadStatus, DesignProjectService } from '@core/application/designProjectService';
export { SettingsLoadStatus, SettingsService } from '@core/application/settingsService';
export {
  CommandRejectionReason,
  homeMachine,
  jogMachine,
  runProgram,
  type JogRejection,
  type MachineStateRejection,
  type ProgramRunRejection,
  type TravelLimitRejection,
} from '@core/application/machineUseCases';
export {
  ConnectionFailureReason,
  MachineConnectionService,
  type ConnectableMachine,
  type ConnectionFailure,
} from '@core/application/machineConnectionService';
export { exportProgram, suggestExportFileName, type ExportRejection } from '@core/application/programUseCases';

// Adapters
export { SimulatedMachine } from '@core/adapters/simulatedMachine';
export { GrblMachine } from '@core/adapters/grblMachine';
