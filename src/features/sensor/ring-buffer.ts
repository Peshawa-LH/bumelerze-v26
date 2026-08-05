/**
 * Fixed-capacity ring buffer. Pushing past capacity silently overwrites the
 * oldest entry — this bounds memory for a ~50 Hz sample stream regardless of
 * how long the Sensor screen stays mounted, without ever needing to
 * slice/shift a growing array on every incoming sample (which would be an
 * allocation on every single sensor callback at native rate).
 */
export class RingBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private writeIndex = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error("RingBuffer capacity must be greater than 0");
    }
    this.buffer = new Array(capacity);
  }

  push(item: T): void {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /** Returns all stored items in chronological order (oldest first). */
  toArray(): T[] {
    if (this.count < this.capacity) {
      return this.buffer.slice(0, this.count) as T[];
    }
    return [
      ...this.buffer.slice(this.writeIndex),
      ...this.buffer.slice(0, this.writeIndex),
    ] as T[];
  }

  clear(): void {
    this.writeIndex = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}
