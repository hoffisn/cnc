import { formatCoordinate } from '@rezets/core';

/** Ready-made program for demonstrating the application without a file at hand. */
export interface SampleProgram {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly source: string;
}

const SAFE_Z = 5;
const coordinate = formatCoordinate;

const PROGRAM_HEADER = ['G21 G90 G17', 'M3 S12000', `G0 Z${SAFE_Z}`];
const PROGRAM_FOOTER = [`G0 Z${SAFE_Z}`, 'M5', 'G0 X0 Y0', 'M30'];

/** Concentric circles forming a round pocket, at the given center and depth. */
function circularPocket(centerX: number, centerY: number, radius: number, depth: number, stepOver: number): string[] {
  const lines = [`G0 X${coordinate(centerX)} Y${coordinate(centerY)}`, `G1 Z${coordinate(depth)} F300`];
  for (let currentRadius = stepOver; currentRadius < radius; currentRadius += stepOver) {
    lines.push(`G1 X${coordinate(centerX + currentRadius)} F900`, `G3 I${coordinate(-currentRadius)} J0`);
  }
  lines.push(`G1 X${coordinate(centerX + radius)} F900`, `G3 I${coordinate(-radius)} J0`, `G0 Z${SAFE_Z}`);
  return lines;
}

/** Stepped round pocket with a ring of petals. Shows off arcs. */
function buildRosetteProgram(): string {
  const petalCount = 8;
  const lines = ['(Rosette: arcs and pockets, tool 6 mm)', ...PROGRAM_HEADER];
  lines.push(...circularPocket(0, 0, 45, -3, 4));
  for (let petal = 0; petal < petalCount; petal += 1) {
    const angle = (petal / petalCount) * Math.PI * 2;
    lines.push(...circularPocket(Math.cos(angle) * 28, Math.sin(angle) * 28, 8, -7, 4));
  }
  lines.push(...circularPocket(0, 0, 10, -10, 4), ...PROGRAM_FOOTER);
  return lines.join('\n');
}

/** Raster finishing of a smooth surface. Shows off true 3D motion in all axes at once. */
function buildWaveSurfaceProgram(): string {
  const width = 120;
  const depth = 80;
  const rowStep = 1.5;
  const pointStep = 1.5;
  const surfaceZ = (x: number, y: number): number =>
    -6 + 2.2 * Math.sin((x / width) * Math.PI * 3) * Math.cos((y / depth) * Math.PI * 2);

  const lines = ['(Wave surface: 3D raster finishing, tool 6 mm)', ...PROGRAM_HEADER, 'G0 X0 Y0', `G1 Z${coordinate(surfaceZ(0, 0))} F600`, 'F1800'];
  let isForward = true;
  for (let y = 0; y <= depth; y += rowStep) {
    for (let step = 0; step <= width / pointStep; step += 1) {
      const x = (isForward ? step : width / pointStep - step) * pointStep;
      lines.push(`G1 X${coordinate(x)} Y${coordinate(y)} Z${coordinate(surfaceZ(x, y))}`);
    }
    isForward = !isForward;
  }
  lines.push(...PROGRAM_FOOTER);
  return lines.join('\n');
}

/** Mounting plate: a rounded contour, a slot and drilled holes. Shows off cycles and mixed moves. */
function buildMountingPlateProgram(): string {
  const lines = ['(Mounting plate: contour, slot, drill cycle)', ...PROGRAM_HEADER];

  for (let passDepth = -2; passDepth >= -6; passDepth -= 2) {
    lines.push(
      'G0 X10 Y0',
      `G1 Z${passDepth} F300`,
      'G1 X90 F1000',
      'G3 X100 Y10 I0 J10',
      'G1 Y50',
      'G3 X90 Y60 I-10 J0',
      'G1 X10',
      'G3 X0 Y50 I0 J-10',
      'G1 Y10',
      'G3 X10 Y0 I10 J0',
      `G0 Z${SAFE_Z}`,
    );
  }

  lines.push('G0 X30 Y30', 'G1 Z-4 F300', 'G1 X70 F800', 'G1 X30', `G0 Z${SAFE_Z}`);
  lines.push('G99 G81 X15 Y15 Z-8 R2 F200', 'X85', 'Y45', 'X15', 'G80');
  lines.push(...PROGRAM_FOOTER);
  return lines.join('\n');
}

/** Programs offered in the "Examples" list. The first one is shown at startup. */
export const SAMPLE_PROGRAMS: readonly SampleProgram[] = [
  { id: 'wave', title: 'Волна (3D-поверхность)', fileName: 'wave.nc', source: buildWaveSurfaceProgram() },
  { id: 'rosette', title: 'Розетка (дуги)', fileName: 'rosette.nc', source: buildRosetteProgram() },
  { id: 'plate', title: 'Плита (контур и отверстия)', fileName: 'plate.nc', source: buildMountingPlateProgram() },
];
