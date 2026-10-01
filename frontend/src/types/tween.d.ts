declare module 'tween.js' {
  export class Tween<T extends { [key: string]: any }> {
    constructor(obj: T);
    to(target: Partial<T>, duration: number): this;
    easing(easing: (k: number) => number): this;
    onUpdate(callback: () => void): this;
    onComplete(callback: () => void): this;
    start(): this;
    stop(): void;
  }

  export namespace Easing {
    namespace Quadratic {
      function InOut(k: number): number;
      function In(k: number): number;
      function Out(k: number): number;
    }
  }

  export function update(time?: number): void;
}
