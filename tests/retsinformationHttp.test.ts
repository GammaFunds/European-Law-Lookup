import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  requestRetsinformationWithRetry,
} from "../src/law/providers/retsinformationHttp";
import type { LawProviderHttpResponse, LawProviderHttpTransport } from "../src/law/httpTransport";
type RetsinformationFetchFn = LawProviderHttpTransport;

function response(status: number, headers?: Record<string, string>): LawProviderHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    text: async () => "",
    json: async () => null,
  };
}

function scriptedTransport(
  outcomes: readonly (number | Error)[],
): { fetchFn: RetsinformationFetchFn; calls: { url: string; options?: unknown }[]; delays: number[] } {
  const calls: { url: string; options?: unknown }[] = [];
  const delays: number[] = [];
  let index = 0;

  const fetchFn: RetsinformationFetchFn = async (url, options) => {
    calls.push({ url, options });
    const outcome = outcomes[Math.min(index, outcomes.length - 1)];
    index += 1;
    if (outcome instanceof Error) throw outcome;
    return response(outcome);
  };

  return { fetchFn, calls, delays };
}

async function run(
  outcomes: readonly (number | Error)[],
  options: { headers?: Record<string, string> } = {},
) {
  const scripted = scriptedTransport(outcomes);
  const result = await requestRetsinformationWithRetry(scripted.fetchFn, "https://example.invalid", {
    ...options,
    sleep: async (ms: number) => {
      scripted.delays.push(ms);
    },
  });
  return { ...scripted, result };
}

describe("Retsinformation bounded retry", () => {
  it("retries HTTP 429 then succeeds", async () => {
    const scripted = await run([429, 200]);
    assert.equal(scripted.result.status, 200);
    assert.equal(scripted.calls.length, 2);
  });

  it("retries HTTP 503 then succeeds", async () => {
    const scripted = await run([503, 200]);
    assert.equal(scripted.result.status, 200);
    assert.equal(scripted.calls.length, 2);
  });

  it("returns a non-retryable 4xx immediately", async () => {
    const scripted = await run([404, 200]);
    assert.equal(scripted.result.status, 404);
    assert.equal(scripted.calls.length, 1);
    assert.deepEqual(scripted.delays, []);
  });

  it("uses Retry-After integer seconds exactly", async () => {
    const scripted = scriptedTransport([429, 200]);
    scripted.fetchFn = async (url, options) => {
      scripted.calls.push({ url, options });
      return scripted.calls.length === 1 ? response(429, { "retry-after": "3" }) : response(200);
    };
    const result = await requestRetsinformationWithRetry(scripted.fetchFn, "https://example.invalid", {
      sleep: async (ms: number) => {
        scripted.delays.push(ms);
      },
    });
    assert.equal(result.status, 200);
    assert.deepEqual(scripted.delays, [3000]);
  });

  it("uses bounded fallback delays when Retry-After is missing", async () => {
    const scripted = await run([429, 503, 429, 200]);
    assert.deepEqual(scripted.delays, [500, 1000, 2000]);
  });

  it("stops persistent retryable responses after four total calls", async () => {
    const scripted = await run([503, 503, 503, 503]);
    assert.equal(scripted.result.status, 503);
    assert.equal(scripted.calls.length, 4);
    assert.deepEqual(scripted.delays, [500, 1000, 2000]);
  });

  it("retries network exceptions with the same bound and rethrows the final error", async () => {
    const error = new Error("network");
    const scripted = scriptedTransport([error, error, error, error]);
    await assert.rejects(
      requestRetsinformationWithRetry(scripted.fetchFn, "https://example.invalid", {
        sleep: async (ms: number) => {
          scripted.delays.push(ms);
        },
      }),
      error,
    );
    assert.equal(scripted.calls.length, 4);
    assert.deepEqual(scripted.delays, [500, 1000, 2000]);
  });

  it("returns an unrelated 5xx immediately", async () => {
    const scripted = await run([501, 200]);
    assert.equal(scripted.result.status, 501);
    assert.equal(scripted.calls.length, 1);
    assert.deepEqual(scripted.delays, []);
  });

  it("uses fallback delay for malformed Retry-After", async () => {
    const scripted = scriptedTransport([429, 200]);
    scripted.fetchFn = async (url, options) => {
      scripted.calls.push({ url, options });
      return scripted.calls.length === 1 ? response(429, { "retry-after": "3.5" }) : response(200);
    };
    await requestRetsinformationWithRetry(scripted.fetchFn, "https://example.invalid", {
      sleep: async (ms: number) => {
        scripted.delays.push(ms);
      },
    });
    assert.deepEqual(scripted.delays, [500]);
  });
});
