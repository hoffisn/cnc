import { inject, type InjectionKey, type Ref, type ShallowRef } from 'vue';
import type { AppSettings, SettingsService } from '@rezets/core';
import type { DesignerViewModel } from '@ui/presentation/designerViewModel';
import type { MachineViewModel } from '@ui/presentation/machineViewModel';
import type { AppSection } from '@ui/presentation/navigation';
import type { NotificationCenter } from '@ui/presentation/notificationCenter';
import type { ProgramWorkspace } from '@ui/presentation/programWorkspace';

/** Everything UI components work with, assembled once at startup. */
export interface AppContext {
  readonly machine: MachineViewModel;
  readonly workspace: ProgramWorkspace;
  readonly designer: DesignerViewModel;
  readonly notifications: NotificationCenter;
  readonly settingsService: SettingsService;
  /** Reactive copy of the current settings. */
  readonly settings: ShallowRef<AppSettings>;
  readonly activeSection: Ref<AppSection>;
}

export const APP_CONTEXT_KEY: InjectionKey<AppContext> = Symbol('AppContext');

/** Gives a component access to the application; available anywhere under the root component. */
export function useAppContext(): AppContext {
  const context = inject(APP_CONTEXT_KEY);
  if (!context) throw new Error('useAppContext must be called under the root component');
  return context;
}
