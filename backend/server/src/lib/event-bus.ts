/**
 * event-bus.ts — In-process pub/sub cho live progress (SSE).
 *
 * Event shape canonical:
 *   { type, project_id?, phase?, agent?, message?, payload?, ts }
 *
 * Subscribers:
 *   subscribe(filter, handler) -> unsubscribe()
 *
 * SSE consumer uu tien topic theo project_id; co the filter type.
 */

import { EventEmitter } from 'node:events';

export interface VctEvent {
  type: string;
  project_id?: string;
  phase?: string | number;
  agent?: string;
  message?: string;
  payload?: unknown;
  ts: number;
}

export type EventListener = (ev: VctEvent) => void;

export interface SubscribeFilter {
  project_id?: string;
  type?: string | RegExp;
}

class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  publish(ev: Omit<VctEvent, 'ts'> & { ts?: number }): void {
    const full: VctEvent = { ts: Date.now(), ...ev };
    this.emitter.emit('event', full);
  }

  subscribe(filter: SubscribeFilter, handler: EventListener): () => void {
    const onEvent = (ev: VctEvent) => {
      if (filter.project_id && ev.project_id && filter.project_id !== ev.project_id) return;
      if (filter.type) {
        if (typeof filter.type === 'string') {
          if (filter.type !== ev.type) return;
        } else if (!filter.type.test(ev.type)) return;
      }
      handler(ev);
    };
    this.emitter.on('event', onEvent);
    return () => this.emitter.off('event', onEvent);
  }

  /** Dung cho debug / metrics */
  listenerCount(): number {
    return this.emitter.listenerCount('event');
  }
}

export const bus = new EventBus();

// Tien ich phat event chuan
export function publishPipelineEvent(ev: Omit<VctEvent, 'ts'>): void {
  bus.publish(ev);
}
