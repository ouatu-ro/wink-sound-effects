export class RingBuffer<T> {
  private readonly values: T[] = [];

  constructor(private readonly capacity: number) {}

  push(value: T) {
    this.values.push(value);
    while (this.values.length > this.capacity) this.values.shift();
  }

  toArray() {
    return [...this.values];
  }

  clear() {
    this.values.length = 0;
  }
}
