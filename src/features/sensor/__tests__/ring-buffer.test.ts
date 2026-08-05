import { RingBuffer } from "../ring-buffer";

describe("RingBuffer", () => {
  it("throws for a non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-1)).toThrow();
  });

  it("returns items in chronological order while under capacity", () => {
    const buffer = new RingBuffer<number>(5);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);

    expect(buffer.toArray()).toEqual([1, 2, 3]);
    expect(buffer.size).toBe(3);
  });

  it("overwrites the oldest entry once capacity is exceeded", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    buffer.push(4); // overwrites 1
    buffer.push(5); // overwrites 2

    expect(buffer.toArray()).toEqual([3, 4, 5]);
    expect(buffer.size).toBe(3);
  });

  it("keeps returning capacity-length arrays no matter how many more items are pushed", () => {
    const buffer = new RingBuffer<number>(4);
    for (let i = 0; i < 100; i++) {
      buffer.push(i);
    }

    expect(buffer.toArray()).toEqual([96, 97, 98, 99]);
    expect(buffer.size).toBe(4);
  });

  it("clear() empties the buffer and resets size", () => {
    const buffer = new RingBuffer<number>(3);
    buffer.push(1);
    buffer.push(2);
    buffer.clear();

    expect(buffer.toArray()).toEqual([]);
    expect(buffer.size).toBe(0);

    buffer.push(9);
    expect(buffer.toArray()).toEqual([9]);
  });

  it("works with object items (the SensorSample use case)", () => {
    const buffer = new RingBuffer<{ t: number }>(2);
    buffer.push({ t: 1 });
    buffer.push({ t: 2 });
    buffer.push({ t: 3 });

    expect(buffer.toArray()).toEqual([{ t: 2 }, { t: 3 }]);
  });
});
