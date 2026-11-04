/** What the viewport shows as the figure. */
export enum ViewportMode {
  /** The tool's trajectory as lines. */
  Toolpath = 'toolpath',
  /** The predicted machined part as a solid. */
  Part = 'part',
}

/** Standard camera directions. */
export enum CameraPreset {
  Isometric = 'isometric',
  Top = 'top',
  Front = 'front',
  Right = 'right',
}
