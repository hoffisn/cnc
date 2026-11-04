/** Time source. Lets tests control timing deterministically. */
export interface Clock {
  /** Current time, in milliseconds. */
  now(): number;
  /**
   * Starts calling a function periodically.
   *
   * @returns Function that stops the calls.
   */
  repeat(intervalMs: number, callback: () => void): () => void;
}
