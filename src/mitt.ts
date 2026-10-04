import type { Emitter, EventType } from 'mitt'

import mitt from 'mitt'

export class AbstractEmitter<T extends Record<EventType, unknown>> implements Emitter<T> {
  private readonly emitter: Emitter<T> = mitt()

  all = this.emitter.all
  emit = this.emitter.emit
  off = this.emitter.off
  on = this.emitter.on
}
