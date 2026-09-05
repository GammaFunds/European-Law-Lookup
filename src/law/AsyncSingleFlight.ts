export class AsyncSingleFlight<T> {
  private inFlight: Promise<T> | null = null;

  run(operation: () => Promise<T>): Promise<T> {
    if (this.inFlight) return this.inFlight;

    const run = Promise.resolve().then(operation);
    this.inFlight = run;

    void run.then(
      () => {
        if (this.inFlight === run) this.inFlight = null;
      },
      () => {
        if (this.inFlight === run) this.inFlight = null;
      },
    );

    return run;
  }
}
