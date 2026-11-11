// Promise wrapper around the engine worker. Calls are answered in order.
import type { EngineCall, EngineResponse } from './protocol'

type Of<T extends EngineResponse['type']> = Extract<EngineResponse, { type: T }>

export class Engine {
  private worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
  private nextId = 1
  private pending = new Map<number, { resolve: (r: EngineResponse) => void; reject: (e: Error) => void }>()

  constructor() {
    this.worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const p = this.pending.get(e.data.id)
      if (!p) return
      this.pending.delete(e.data.id)
      if (e.data.type === 'error') p.reject(new Error(e.data.message))
      else p.resolve(e.data)
    }
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Engine worker crashed'))
      this.pending.clear()
    }
  }

  call<T extends EngineResponse['type']>(msg: EngineCall): Promise<Of<T>> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: EngineResponse) => void, reject })
      this.worker.postMessage({ ...msg, id })
    })
  }
}
