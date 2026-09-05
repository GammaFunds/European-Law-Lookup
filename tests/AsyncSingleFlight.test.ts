import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { AsyncSingleFlight } from "../src/law/AsyncSingleFlight";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("AsyncSingleFlight", () => {
  it("coalesces concurrent callers onto exactly one in-flight operation and completion", async () => {
    const gate = deferred<number>();
    const singleFlight = new AsyncSingleFlight<number>();
    let calls = 0;

    const first = singleFlight.run(async () => {
      calls += 1;
      return gate.promise;
    });
    const second = singleFlight.run(async () => {
      calls += 1;
      return 999;
    });

    assert.equal(first, second, "concurrent callers must receive the same in-flight promise");
    await Promise.resolve();
    assert.equal(calls, 1, "the underlying operation must run exactly once");

    gate.resolve(42);
    assert.deepEqual(await Promise.all([first, second]), [42, 42]);

    const third = singleFlight.run(async () => {
      calls += 1;
      return 7;
    });
    assert.notEqual(third, first, "a settled flight must not be reused");
    assert.equal(await third, 7);
    assert.equal(calls, 2);
  });

  it("clears a rejected flight so a later caller can retry", async () => {
    const singleFlight = new AsyncSingleFlight<number>();
    let calls = 0;

    await assert.rejects(singleFlight.run(async () => {
      calls += 1;
      throw new Error("expected failure");
    }));

    const retry = singleFlight.run(async () => {
      calls += 1;
      return 11;
    });

    assert.equal(await retry, 11);
    assert.equal(calls, 2);
  });
});
