type EventHandler<T = unknown> = (data: T) => void;

export type ChannelBusEvent =
  | 'approval:requested'
  | 'approval:decided'
  | 'task:created'
  | 'task:completed'
  | 'channel:paired';

export class ChannelEventBus {
  private handlers = new Map<string, Set<EventHandler>>();

  on(event: ChannelBusEvent, handler: EventHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
  }

  off(event: ChannelBusEvent, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: ChannelBusEvent, data: unknown): void {
    this.handlers.get(event)?.forEach((h) => {
      try {
        h(data);
      } catch {
        // Ignore handler errors
      }
    });
  }
}

let eventBus: ChannelEventBus | null = null;

export function getChannelEventBus(): ChannelEventBus {
  if (!eventBus) {
    eventBus = new ChannelEventBus();
  }
  return eventBus;
}
