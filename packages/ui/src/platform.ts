import type {
  DesignProjectRepository,
  MachineLinkProvider,
  ProgramFileGateway,
  SettingsRepository,
} from '@rezets/core';

/** How detailed the predicted part is: finer looks better, coarser stays fluid on modest hardware. */
export interface ReliefQuality {
  /** Grid nodes along the longer side when showing a loaded G-code program. */
  readonly programResolution: number;
  /** Grid nodes along the longer side when showing a whole sheet in the designer. */
  readonly designResolution: number;
}

/**
 * Everything the interface needs from the device it runs on.
 * Each application implements this once, and the interface itself stays the same on all of them.
 */
export interface PlatformServices {
  readonly settingsRepository: SettingsRepository;
  readonly designProjectRepository: DesignProjectRepository;
  readonly programFileGateway: ProgramFileGateway;
  readonly machineLinkProvider: MachineLinkProvider;
  readonly reliefQuality: ReliefQuality;
}
