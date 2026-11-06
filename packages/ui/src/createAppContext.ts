import { ref, shallowRef } from 'vue';
import {
  DesignProjectLoadStatus,
  DesignProjectService,
  GrblMachine,
  MachineConnectionService,
  SettingsLoadStatus,
  SettingsService,
  SimulatedMachine,
} from '@rezets/core';
import { browserClock } from '@ui/infrastructure/browserClock';
import type { PlatformServices } from '@ui/platform';
import type { AppContext } from '@ui/presentation/appContext';
import { DesignerViewModel } from '@ui/presentation/designerViewModel';
import { MachineViewModel } from '@ui/presentation/machineViewModel';
import { AppSection } from '@ui/presentation/navigation';
import { NotificationCenter, NotificationTone } from '@ui/presentation/notificationCenter';
import { ProgramWorkspace } from '@ui/presentation/programWorkspace';
import { SAMPLE_PROGRAMS } from '@ui/presentation/samplePrograms';

const SETTINGS_LOAD_MESSAGES: Readonly<Partial<Record<SettingsLoadStatus, string>>> = {
  [SettingsLoadStatus.Recovered]: 'Часть настроек была повреждена и заменена значениями по умолчанию',
  [SettingsLoadStatus.Failed]: 'Не удалось прочитать настройки: используются значения по умолчанию',
};

const PROJECT_LOAD_MESSAGES: Readonly<Partial<Record<DesignProjectLoadStatus, string>>> = {
  [DesignProjectLoadStatus.Recovered]: 'Часть проекта была повреждена: сохранённые данные восстановлены не полностью',
  [DesignProjectLoadStatus.Failed]: 'Не удалось прочитать проект: начат новый',
};

/**
 * The composition root of the interface: the only place where use cases meet their adapters.
 * Device-specific adapters arrive from the application, so the interface never knows what it runs on.
 */
export async function createAppContext(platform: PlatformServices): Promise<AppContext> {
  const notifications = new NotificationCenter();
  const generateId = (): string => crypto.randomUUID();

  const settingsService = new SettingsService(platform.settingsRepository, generateId);
  settingsService.onPersistFailure(() => notifications.show(NotificationTone.Error, 'Не удалось сохранить настройки'));
  const settingsLoadMessage = SETTINGS_LOAD_MESSAGES[await settingsService.load()];
  if (settingsLoadMessage) notifications.show(NotificationTone.Warning, settingsLoadMessage);

  const settings = shallowRef(settingsService.current);
  settingsService.subscribe((changedSettings) => {
    settings.value = changedSettings;
  });

  const projectService = new DesignProjectService(platform.designProjectRepository, generateId);
  projectService.onPersistFailure(() => notifications.show(NotificationTone.Error, 'Не удалось сохранить проект'));
  const projectLoadMessage = PROJECT_LOAD_MESSAGES[await projectService.load()];
  if (projectLoadMessage) notifications.show(NotificationTone.Warning, projectLoadMessage);

  const connectionService = new MachineConnectionService(
    platform.machineLinkProvider,
    () => new SimulatedMachine(browserClock),
    (link) => new GrblMachine(link, browserClock),
  );

  const fileGateway = platform.programFileGateway;
  const machine = new MachineViewModel(connectionService, notifications, () => settings.value.machine);
  const workspace = new ProgramWorkspace(
    fileGateway,
    notifications,
    () => settings.value.machine.toolDiameter,
    platform.reliefQuality.programResolution,
  );

  const [startupSample] = SAMPLE_PROGRAMS;
  if (startupSample) workspace.loadFile({ fileName: startupSample.fileName, text: startupSample.source });

  // A returning engineer continues the drawing; a new one starts by describing the sheet.
  const activeSection = ref(projectService.current.operations.length > 0 ? AppSection.Designer : AppSection.WorkSurface);

  const designer = new DesignerViewModel({
    projectService,
    fileGateway,
    workspace,
    machine,
    notifications,
    activeSection,
    reliefResolution: platform.reliefQuality.designResolution,
    getMachineSettings: () => settings.value.machine,
    updateMachineSettings: (machineSettings) => settingsService.updateMachineSettings(machineSettings),
  });

  return { machine, workspace, designer, notifications, settingsService, settings, activeSection };
}
