/**
 * Decodes a program file. Modern files are UTF-8, but controllers and older CAM systems on
 * Russian-language machines still write comments in Windows-1251.
 */
export function decodeProgramBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}
