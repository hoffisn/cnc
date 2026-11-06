import { shallowRef, type ShallowRef } from 'vue';

/** Visual weight of a notification. */
export enum NotificationTone {
  Info = 'info',
  Success = 'success',
  Warning = 'warning',
  Error = 'error',
}

/** Short message shown to the operator. */
export interface AppNotification {
  readonly id: number;
  readonly tone: NotificationTone;
  readonly message: string;
}

const AUTO_DISMISS_MS: Readonly<Record<NotificationTone, number | null>> = {
  [NotificationTone.Info]: 4000,
  [NotificationTone.Success]: 4000,
  [NotificationTone.Warning]: 7000,
  /** Errors stay until dismissed: an operator at the machine may not be looking right now. */
  [NotificationTone.Error]: null,
};

/** Queue of messages for the operator. */
export class NotificationCenter {
  readonly notifications: ShallowRef<readonly AppNotification[]> = shallowRef([]);
  private nextId = 1;

  show(tone: NotificationTone, message: string): void {
    const id = this.nextId;
    this.nextId += 1;
    this.notifications.value = [...this.notifications.value, { id, tone, message }];
    const dismissDelay = AUTO_DISMISS_MS[tone];
    if (dismissDelay !== null) window.setTimeout(() => this.dismiss(id), dismissDelay);
  }

  dismiss(id: number): void {
    this.notifications.value = this.notifications.value.filter((notification) => notification.id !== id);
  }
}
