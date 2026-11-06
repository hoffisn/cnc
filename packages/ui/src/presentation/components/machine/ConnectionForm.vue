<script setup lang="ts">
import { computed, onMounted, ref, shallowRef } from 'vue';
import { RefreshCw } from '@lucide/vue';
import { MachineLinkKind, type MachineLinkTarget, type SerialPortInfo } from '@rezets/core';
import { useAppContext } from '@ui/presentation/appContext';
import NumberField from '@ui/presentation/components/ui/NumberField.vue';
import SegmentedControl from '@ui/presentation/components/ui/SegmentedControl.vue';
import UiButton from '@ui/presentation/components/ui/UiButton.vue';
import { ButtonVariant } from '@ui/presentation/components/ui/buttonVariant';

const { machine } = useAppContext();

/** What the form connects to: a real channel, or no machine at all. */
enum ConnectionChoice {
  Simulator = 'simulator',
  Serial = 'serial',
  Network = 'network',
}

const CHOICE_OPTIONS = [
  { value: ConnectionChoice.Simulator, label: 'Симулятор' },
  { value: ConnectionChoice.Serial, label: 'USB / COM-порт' },
  { value: ConnectionChoice.Network, label: 'Сеть' },
];

/** Common Grbl speeds; 115200 is the default since Grbl 0.9. */
const BAUD_RATES = [115200, 250000, 57600, 38400, 19200, 9600];
const DEFAULT_TCP_PORT = 23;

function initialChoice(): ConnectionChoice {
  const target = machine.activeTarget.value;
  if (!target) return ConnectionChoice.Simulator;
  return target.kind === MachineLinkKind.Serial ? ConnectionChoice.Serial : ConnectionChoice.Network;
}

const choice = ref(initialChoice());
const serialPorts = shallowRef<readonly SerialPortInfo[]>([]);
const selectedPortPath = ref('');
const baudRate = ref(BAUD_RATES[0] as number);
const networkHost = ref('192.168.1.100');
const networkPort = ref(DEFAULT_TCP_PORT);
const isConnecting = ref(false);
const failureText = ref('');

async function refreshPorts(): Promise<void> {
  try {
    serialPorts.value = await machine.listSerialPorts();
    if (!serialPorts.value.some((port) => port.portPath === selectedPortPath.value)) {
      selectedPortPath.value = serialPorts.value[0]?.portPath ?? '';
    }
  } catch {
    failureText.value = 'Не удалось получить список портов';
  }
}

onMounted(refreshPorts);

function resolveSelectedTarget(): MachineLinkTarget | null {
  switch (choice.value) {
    case ConnectionChoice.Simulator:
      return null;
    case ConnectionChoice.Serial:
      return { kind: MachineLinkKind.Serial, portPath: selectedPortPath.value, baudRate: baudRate.value };
    case ConnectionChoice.Network:
      return { kind: MachineLinkKind.Tcp, host: networkHost.value.trim(), port: networkPort.value };
  }
}

function isChoiceComplete(): boolean {
  switch (choice.value) {
    case ConnectionChoice.Simulator:
      return machine.activeTarget.value !== null;
    case ConnectionChoice.Serial:
      return selectedPortPath.value !== '';
    case ConnectionChoice.Network:
      return networkHost.value.trim() !== '';
  }
}

const selectedTarget = computed(resolveSelectedTarget);
const canApply = computed(() => !isConnecting.value && isChoiceComplete());

async function apply(): Promise<void> {
  failureText.value = '';
  isConnecting.value = true;
  const target = selectedTarget.value;
  const failure = target ? await machine.connect(target) : machine.disconnect();
  isConnecting.value = false;
  if (failure) failureText.value = failure;
}
</script>

<template>
  <section class="card form">
    <header>
      <h2 class="card-title">Подключение станка</h2>
      <p class="form__current">Сейчас: <strong data-testid="connection-current">{{ machine.connectionLabel.value }}</strong></p>
    </header>

    <SegmentedControl v-model="choice" :options="CHOICE_OPTIONS" class="form__choice" />

    <p v-if="choice === ConnectionChoice.Simulator" class="form__hint">
      Станок не нужен: движения считаются программой, на оборудование ничего не отправляется.
    </p>

    <template v-else-if="choice === ConnectionChoice.Serial">
      <p class="form__hint">Для станков с USB или RS-232. На планшете нужен переходник OTG. Контроллер должен работать на GRBL, grblHAL или FluidNC.</p>
      <div class="field">
        <span class="field__label">Порт</span>
        <div class="form__port-row">
          <select v-model="selectedPortPath" class="field__input" data-testid="serial-port-select" :disabled="serialPorts.length === 0">
            <option v-if="serialPorts.length === 0" value="">Порты не найдены</option>
            <option v-for="port in serialPorts" :key="port.portPath" :value="port.portPath">
              {{ port.portPath }}{{ port.manufacturer ? ` — ${port.manufacturer}` : '' }}
            </option>
          </select>
          <UiButton icon-only title="Обновить список" @click="refreshPorts"><RefreshCw :size="18" /></UiButton>
        </div>
      </div>
      <div class="field">
        <span class="field__label">Скорость порта</span>
        <select v-model="baudRate" class="field__input">
          <option v-for="rate in BAUD_RATES" :key="rate" :value="rate">{{ rate }} бод</option>
        </select>
      </div>
    </template>

    <template v-else>
      <p class="form__hint">Для контроллеров с Ethernet или Wi-Fi (grblHAL, FluidNC): порт обычно 23.</p>
      <div class="form__network-row">
        <label class="field">
          <span class="field__label">Адрес</span>
          <input v-model="networkHost" class="field__input" data-testid="network-host" />
        </label>
        <NumberField v-model="networkPort" label="Порт" data-testid="network-port" />
      </div>
    </template>

    <p v-if="failureText" class="form__failure" data-testid="connection-failure">{{ failureText }}</p>

    <UiButton :variant="ButtonVariant.Primary" :disabled="!canApply" data-testid="connection-apply" @click="apply">
      {{ isConnecting ? 'Подключение…' : selectedTarget ? 'Подключить' : 'Использовать симулятор' }}
    </UiButton>
  </section>
</template>

<style scoped>
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 20px;
}

.form__current {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
}

.form__current strong {
  color: var(--color-text);
}

.form__choice {
  display: flex;
}

.form__hint {
  margin: 0;
  color: var(--color-text-secondary);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field__label {
  color: var(--color-text-secondary);
  font-size: 13px;
}

.field__input {
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 1.5px solid transparent;
  border-radius: var(--radius-small);
  outline: 0;
  background: var(--color-surface-muted);
  font-weight: 550;
}

.field__input:focus {
  border-color: var(--color-text);
}

.form__port-row {
  display: flex;
  gap: 8px;
}

.form__network-row {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
}

.form__failure {
  margin: 0;
  padding: 12px;
  border-radius: var(--radius-small);
  background: var(--color-danger-soft);
  color: var(--color-danger);
}
</style>
