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
import { browserClock } from '@/infrastructure/browserClock';
import {
  createDesignProjectRepository,
  createMachineLinkProvider,
  createProgramFileGateway,
  createSettingsRepository,
} from '@/infrastructure/desktopAdapters';
import type { AppContext } from '@/presentation/appContext';
import { DesignerViewModel } from '@/presentation/designerViewModel';
import { MachineViewModel } from '@/presentation/machineViewModel';
import { AppSection } from '@/presentation/navigation';
import { NotificationCenter, NotificationTone } from '@/presentation/notificationCenter';
import { ProgramWorkspace } from '@/presentation/programWorkspace';
import { SAMPLE_PROGRAMS } from '@/presentation/samplePrograms';

const SETTINGS_LOAD_MESSAGES: Readonly<Partial<Record<SettingsLoadStatus, string>>> = {
  [SettingsLoadStatus.Recovered]: 'Часть настроек была повреждена и заменена значениями по умолчанию',
  [SettingsLoadStatus.Failed]: 'Не удалось прочитать настройки: используются значения по умолчанию',
};

const PROJECT_LOAD_MESSAGES: Readonly<Partial<Record<DesignProjectLoadStatus, string>>> = {
  [DesignProjectLoadStatus.Recovered]: 'Часть проекта была повреждена: сохранённые данные восстановлены не полностью',
  [DesignProjectLoadStatus.Failed]: 'Не удалось прочитать проект: начат новый',
};

/**
 * The composition root: the only place that knows which concrete adapters serve which ports.
 * Everything else depends on abstractions, so swapping an adapter touches this one file.
 */
export async function createAppContext(): Promise<AppContext> {
  const bridge = window.desktopBridge;
  const notifications = new NotificationCenter();
  const generateId = (): string => crypto.randomUUID();

  const settingsService = new SettingsService(createSettingsRepository(bridge), generateId);
  settingsService.onPersistFailure(() => notifications.show(NotificationTone.Error, 'Не удалось сохранить настройки'));
  const settingsLoadMessage = SETTINGS_LOAD_MESSAGES[await settingsService.load()];
  if (settingsLoadMessage) notifications.show(NotificationTone.Warning, settingsLoadMessage);

  const settings = shallowRef(settingsService.current);
  settingsService.subscribe((changedSettings) => {
    settings.value = changedSettings;
  });

  const projectService = new DesignProjectService(createDesignProjectRepository(bridge), generateId);
  projectService.onPersistFailure(() => notifications.show(NotificationTone.Error, 'Не удалось сохранить проект'));
  const projectLoadMessage = PROJECT_LOAD_MESSAGES[await projectService.load()];
  if (projectLoadMessage) notifications.show(NotificationTone.Warning, projectLoadMessage);

  const connectionService = new MachineConnectionService(
    createMachineLinkProvider(bridge),
    () => new SimulatedMachine(browserClock),
    (link) => new GrblMachine(link, browserClock),
  );

  const fileGateway = createProgramFileGateway(bridge);
  const machine = new MachineViewModel(connectionService, notifications, () => settings.value.machine);
  const workspace = new ProgramWorkspace(fileGateway, notifications, () => settings.value.machine.toolDiameter);

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
    getMachineSettings: () => settings.value.machine,
    updateMachineSettings: (machineSettings) => settingsService.updateMachineSettings(machineSettings),
  });

  return { machine, workspace, designer, notifications, settingsService, settings, activeSection };
}
