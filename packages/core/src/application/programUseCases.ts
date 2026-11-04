import { generateGCode } from '@core/domain/gcode/generator';
import { hasProgramErrors, type GCodeProgram } from '@core/domain/gcode/program';
import { err, type Result } from '@core/domain/shared/result';
import { isIdentityScale, type ScaleTransform } from '@core/domain/transform/scaleTransform';
import type { ProgramFileGateway, SaveProgramResult } from '@core/application/ports/programFileGateway';
import { CommandRejectionReason } from './machineUseCases';

const UNTITLED_PROGRAM_FILE_NAME = 'program.nc';
const SCALED_FILE_SUFFIX = '_scaled';
const DEFAULT_PROGRAM_EXTENSION = '.nc';

/**
 * Suggests a name for an exported program.
 * A scaled copy gets a distinct name so that it cannot silently overwrite the original.
 */
export function suggestExportFileName(sourceFileName: string | null, scale: ScaleTransform): string {
  const fileName = sourceFileName ?? UNTITLED_PROGRAM_FILE_NAME;
  if (isIdentityScale(scale)) return fileName;
  const extensionIndex = fileName.lastIndexOf('.');
  return extensionIndex > 0
    ? `${fileName.slice(0, extensionIndex)}${SCALED_FILE_SUFFIX}${fileName.slice(extensionIndex)}`
    : `${fileName}${SCALED_FILE_SUFFIX}${DEFAULT_PROGRAM_EXTENSION}`;
}

/** Why a program export was rejected. */
export type ExportRejection = { readonly reason: CommandRejectionReason.ProgramHasErrors };

/**
 * Saves a program with scaling applied.
 * Programs with errors are refused: their geometry is partly guessed and must not reach a machine.
 */
export async function exportProgram(
  gateway: ProgramFileGateway,
  program: GCodeProgram,
  scale: ScaleTransform,
  sourceFileName: string | null,
): Promise<Result<SaveProgramResult, ExportRejection>> {
  if (hasProgramErrors(program)) return err({ reason: CommandRejectionReason.ProgramHasErrors });
  const saveResult = await gateway.save(suggestExportFileName(sourceFileName, scale), generateGCode(program, scale));
  return { ok: true, value: saveResult };
}
