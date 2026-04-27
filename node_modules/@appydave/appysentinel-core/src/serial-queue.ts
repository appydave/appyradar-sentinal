/**
 * SerialQueue — promise-chain serialisation primitive.
 *
 * Ensures tasks run in submission order, one at a time. Non-blocking to
 * callers — `enqueue` returns a promise that resolves when the task completes.
 *
 * Use when ordered I/O matters (e.g. JSONL append, atomic file write,
 * subprocess request stream).
 */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private pendingCount = 0;

  /**
   * Enqueue a task. The task runs after every previously-enqueued task
   * resolves (or rejects). The returned promise resolves with the task's
   * value, or rejects with the task's error.
   *
   * Importantly, errors do NOT poison the chain — subsequent tasks still run.
   */
  enqueue<T>(task: () => Promise<T> | T): Promise<T> {
    this.pendingCount += 1;
    const run = this.tail.then(
      () => task(),
      () => task() // never let a previous failure block the next task
    );
    // The chain itself absorbs errors so subsequent enqueues don't see them.
    // Track pending count off the swallowed chain too — otherwise the unhandled
    // rejection lands on `run.finally(...)` when the caller awaits before the
    // microtask flush.
    const tracked = run.catch(() => undefined).then(() => {
      this.pendingCount -= 1;
    });
    this.tail = tracked;
    return run as Promise<T>;
  }

  /**
   * Resolve once the queue has fully drained (no pending tasks).
   */
  async drain(): Promise<void> {
    while (this.pendingCount > 0) {
      await this.tail;
    }
  }

  /**
   * Number of tasks currently queued or running.
   */
  get size(): number {
    return this.pendingCount;
  }
}
