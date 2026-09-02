import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  CELLAR_HTTP_RETRY_BACKOFF_MS,
  CELLAR_MAX_TOTAL_HTTP_ATTEMPTS,
  CELLAR_RETRYABLE_HTTP_STATUSES,
  CellarHttpRequestError,
  createCellarSparqlJsonFetcher,
  createObsidianRequestUrlPostTransport,
  createObsidianRequestUrlTransport,
  isRetryableCellarHttpStatus,
  requestCellarWithRetry,
  type RequestUrlLike,
} from "../src/law/httpTransport";
import { CELLAR_SPARQL_ENDPOINT } from "../src/law/providers/CellarMetadataClient";

describe("createObsidianRequestUrlTransport", () => {
  it("adapts requestUrl responses to the provider HTTP shape", async () => {
    const calls: unknown[] = [];
    const requestUrl: RequestUrlLike = async (request) => {
      calls.push(request);
      return {
        status: 200,
        text: "<html>fixture</html>",
        json: { ok: true },
      };
    };

    const transport = createObsidianRequestUrlTransport(requestUrl);
    const response = await transport("https://www.gesetze-im-internet.de/bgb/__823.html");

    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "<html>fixture</html>");
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(calls, [
      {
        url: "https://www.gesetze-im-internet.de/bgb/__823.html",
        method: "GET",
        throw: false,
      },
    ]);
  });

  it("keeps non-2xx statuses inspectable instead of throwing by default", async () => {
    const requestUrl: RequestUrlLike = async () => ({
      status: 404,
      text: "not found",
      json: { error: "not found" },
    });

    const response = await createObsidianRequestUrlTransport(requestUrl)(
      "https://www.gesetze-im-internet.de/bgb/__99999.html",
    );

    assert.equal(response.ok, false);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "not found");
  });

  it("forwards optional GET headers exactly", async () => {
    const calls: unknown[] = [];
    const requestUrl: RequestUrlLike = async (request) => {
      calls.push(request);
      return {
        status: 200,
        text: "ok",
        json: {},
      };
    };

    const transport = createObsidianRequestUrlTransport(requestUrl);
    await transport("https://publications.europa.eu/resource/celex/32016R0679", {
      headers: {
        Accept: "application/xhtml+xml",
        "Accept-Language": "deu",
        "Accept-Max-Cs-Size": "8388608",
      },
    });

    assert.deepEqual(calls, [
      {
        url: "https://publications.europa.eu/resource/celex/32016R0679",
        method: "GET",
        headers: {
          Accept: "application/xhtml+xml",
          "Accept-Language": "deu",
          "Accept-Max-Cs-Size": "8388608",
        },
        throw: false,
      },
    ]);
  });
});

describe("createObsidianRequestUrlPostTransport", () => {
  it("sends POST request with JSON Content-Type and unchanged body", async () => {
    const calls: unknown[] = [];
    const requestUrl: RequestUrlLike = async (request) => {
      calls.push(request);
      return {
        status: 200,
        text: '{"ok":true}',
        json: { ok: true },
      };
    };

    const transport = createObsidianRequestUrlPostTransport(requestUrl);
    const body = JSON.stringify({ query: { match_all: {} } });
    const response = await transport("https://example.com/search", body);

    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"ok":true}');
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(calls, [
      {
        url: "https://example.com/search",
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
        throw: false,
      },
    ]);
  });

  it("does not JSON.stringify the body again", async () => {
    let capturedBody: string | undefined;
    const requestUrl: RequestUrlLike = async (request) => {
      capturedBody = typeof request !== 'string' ? request.body : undefined;
      return { status: 200, text: "", json: {} };
    };

    const transport = createObsidianRequestUrlPostTransport(requestUrl);
    const original = '{"query":{"term":{"id":"test"}}}';
    await transport("https://example.com/search", original);

    assert.equal(capturedBody, original);
  });

  it("preserves non-2xx status on POST", async () => {
    const requestUrl: RequestUrlLike = async () => ({
      status: 404,
      text: "not found",
      json: {},
    });

    const transport = createObsidianRequestUrlPostTransport(requestUrl);
    const response = await transport("https://example.com/search", "{}");

    assert.equal(response.ok, false);
    assert.equal(response.status, 404);
  });

  it("existing GET transport tuple remains unchanged", async () => {
    const calls: unknown[] = [];
    const requestUrl: RequestUrlLike = async (request) => {
      calls.push(request);
      return { status: 200, text: "ok", json: {} };
    };

    const transport = createObsidianRequestUrlTransport(requestUrl);
    await transport("https://example.com/resource");

    assert.deepEqual(calls, [
      {
        url: "https://example.com/resource",
        method: "GET",
        throw: false,
      },
    ]);
  });
});

const SPARQL_JSON_FIXTURE = { results: { bindings: [] } };

function scriptedCellarSparql(
  statuses: readonly number[],
  json: unknown = SPARQL_JSON_FIXTURE,
): {
  fetchSparqlJson: (query: string) => Promise<unknown>;
  calls: unknown[];
  delays: number[];
} {
  const calls: unknown[] = [];
  const delays: number[] = [];
  let attempt = 0;
  const requestUrl: RequestUrlLike = async (request) => {
    calls.push(request);
    const status = statuses[Math.min(attempt, statuses.length - 1)];
    attempt += 1;
    return { status, text: JSON.stringify(json), json };
  };

  return {
    fetchSparqlJson: createCellarSparqlJsonFetcher(requestUrl, {
      sleep: async (ms: number) => {
        delays.push(ms);
      },
    }),
    calls,
    delays,
  };
}

describe("CELLAR SPARQL transient HTTP retry policy", () => {
  it("freezes the approved bounded retry policy", () => {
    assert.deepEqual([...CELLAR_RETRYABLE_HTTP_STATUSES], [429, 500, 502, 503, 504]);
    assert.equal(CELLAR_MAX_TOTAL_HTTP_ATTEMPTS, 4);
    assert.deepEqual([...CELLAR_HTTP_RETRY_BACKOFF_MS], [500, 1000, 2000]);
  });

  it("classifies retryable and non-retryable statuses", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      assert.equal(isRetryableCellarHttpStatus(status), true, `expected ${status} retryable`);
    }
    for (const status of [200, 204, 400, 401, 403, 404, 410, 501]) {
      assert.equal(isRetryableCellarHttpStatus(status), false, `expected ${status} non-retryable`);
    }
  });

  it("recovers from a single transient 503 after exactly two attempts", async () => {
    const scripted = scriptedCellarSparql([503, 200]);

    const json = await scripted.fetchSparqlJson("SELECT * WHERE { ?s ?p ?o } LIMIT 1");

    assert.deepEqual(json, SPARQL_JSON_FIXTURE);
    assert.equal(scripted.calls.length, 2);
    assert.deepEqual(scripted.delays, [500]);
  });

  it("retries every approved transient status exactly once before success", async () => {
    for (const status of [429, 500, 502, 504]) {
      const scripted = scriptedCellarSparql([status, 200]);

      const json = await scripted.fetchSparqlJson("SELECT * WHERE { ?s ?p ?o } LIMIT 1");

      assert.deepEqual(json, SPARQL_JSON_FIXTURE, `status ${status} should recover`);
      assert.equal(scripted.calls.length, 2, `status ${status} should use two attempts`);
      assert.deepEqual(scripted.delays, [500], `status ${status} backoff`);
    }
  });

  it("stops after exactly four attempts when transient failures persist", async () => {
    const scripted = scriptedCellarSparql([503, 503, 503, 503]);

    const error = await scripted
      .fetchSparqlJson("SELECT * WHERE { ?secret ?p ?o }")
      .then(
        () => null,
        (caught: unknown) => caught,
      );

    assert.ok(error instanceof CellarHttpRequestError);
    assert.equal(error.status, 503);
    assert.equal(error.attempts, 4);
    assert.equal(scripted.calls.length, 4);
    assert.equal(scripted.calls.length, CELLAR_MAX_TOTAL_HTTP_ATTEMPTS);
    assert.deepEqual(scripted.delays, [500, 1000, 2000]);
    assert.match(error.message, /503/);
    assert.doesNotMatch(error.message, /secret/);
  });

  it("never retries a non-retryable client error", async () => {
    const scripted = scriptedCellarSparql([404, 200]);

    const error = await scripted.fetchSparqlJson("SELECT * WHERE { ?s ?p ?o }").then(
      () => null,
      (caught: unknown) => caught,
    );

    assert.ok(error instanceof CellarHttpRequestError);
    assert.equal(error.status, 404);
    assert.equal(error.attempts, 1);
    assert.equal(scripted.calls.length, 1);
    assert.deepEqual(scripted.delays, []);
  });

  it("uses exactly one attempt for a successful SPARQL request", async () => {
    const scripted = scriptedCellarSparql([200]);
    const query = "SELECT * WHERE { ?s ?p ?o } LIMIT 1";

    const json = await scripted.fetchSparqlJson(query);

    assert.deepEqual(json, SPARQL_JSON_FIXTURE);
    assert.equal(scripted.calls.length, 1);
    assert.deepEqual(scripted.delays, []);
    assert.deepEqual(scripted.calls, [
      {
        url: `${CELLAR_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}`,
        method: "GET",
        headers: { Accept: "application/sparql-results+json" },
        throw: false,
      },
    ]);
  });

  it("does not introduce retries into the shared provider transports", async () => {
    const getCalls: unknown[] = [];
    const getRequestUrl: RequestUrlLike = async (request) => {
      getCalls.push(request);
      return { status: 503, text: "unavailable", json: {} };
    };
    const getResponse = await createObsidianRequestUrlTransport(getRequestUrl)(
      "https://www.gesetze-im-internet.de/bgb/__823.html",
    );
    assert.equal(getCalls.length, 1);
    assert.equal(getResponse.ok, false);
    assert.equal(getResponse.status, 503);

    const postCalls: unknown[] = [];
    const postRequestUrl: RequestUrlLike = async (request) => {
      postCalls.push(request);
      return { status: 503, text: "unavailable", json: {} };
    };
    const postResponse = await createObsidianRequestUrlPostTransport(postRequestUrl)(
      "https://example.com/search",
      "{}",
    );
    assert.equal(postCalls.length, 1);
    assert.equal(postResponse.ok, false);
    assert.equal(postResponse.status, 503);
  });
});

type ScriptedCellarAttempt = { throws: Error } | { status: number };

function scriptedCellarAttempts(steps: readonly ScriptedCellarAttempt[]): {
  run: () => Promise<{ status: number }>;
  attempts: () => number;
  delays: number[];
} {
  const delays: number[] = [];
  let attempt = 0;

  const request = async (): Promise<{ status: number }> => {
    const step = steps[Math.min(attempt, steps.length - 1)];
    attempt += 1;
    if ("throws" in step) throw step.throws;
    return { status: step.status };
  };

  return {
    run: () =>
      requestCellarWithRetry(request, {
        sleep: async (ms: number) => {
          delays.push(ms);
        },
      }),
    attempts: () => attempt,
    delays,
  };
}

describe("CELLAR SPARQL thrown transport failure retry policy", () => {
  it("recovers from a thrown transport failure after exactly two attempts", async () => {
    const scripted = scriptedCellarAttempts([
      { throws: new Error("temporary transport failure") },
      { status: 200 },
    ]);

    const response = await scripted.run();

    assert.equal(response.status, 200);
    assert.equal(scripted.attempts(), 2);
    assert.deepEqual(scripted.delays, [500]);
  });

  it("stops after exactly four attempts when the transport keeps throwing", async () => {
    const errors = [
      new Error("transport failure 1"),
      new Error("transport failure 2"),
      new Error("transport failure 3"),
      new Error("transport failure 4"),
    ];
    const scripted = scriptedCellarAttempts(errors.map((throws) => ({ throws })));

    const caught = await scripted.run().then(
      () => null,
      (error: unknown) => error,
    );

    assert.equal(caught, errors[3]);
    assert.equal(caught instanceof CellarHttpRequestError, false);
    assert.equal((caught as Error).message, "transport failure 4");
    assert.equal(scripted.attempts(), 4);
    assert.equal(scripted.attempts(), CELLAR_MAX_TOTAL_HTTP_ATTEMPTS);
    assert.deepEqual(scripted.delays, [500, 1000, 2000]);
  });

  it("shares one total attempt budget between thrown and retryable HTTP failures", async () => {
    const scripted = scriptedCellarAttempts([
      { throws: new Error("temporary transport failure") },
      { status: 503 },
      { throws: new Error("temporary transport failure again") },
      { status: 200 },
    ]);

    const response = await scripted.run();

    assert.equal(response.status, 200);
    assert.equal(scripted.attempts(), 4);
    assert.deepEqual(scripted.delays, [500, 1000, 2000]);
  });
});

describe("CELLAR SPARQL retry ownership", () => {
  it("wires the retry-aware SPARQL fetcher into DeLawPlugin.createCellarTransport", () => {
    const source = readFileSync(resolve(__dirname, "../../src/main.ts"), "utf8");
    const start = source.indexOf("private createCellarTransport()");
    assert.ok(start >= 0, "createCellarTransport() must exist in src/main.ts");
    const end = source.indexOf("private async refreshEuActIndex", start);
    assert.ok(end > start, "createCellarTransport() body must be locatable");
    const body = source.slice(start, end);
    const sparqlSection = body.slice(0, body.indexOf("fetchWorkRdf"));

    assert.match(source, /createCellarSparqlJsonFetcher/);
    assert.match(sparqlSection, /fetchSparqlJson:\s*createCellarSparqlJsonFetcher\(requestUrl\)/);
    assert.doesNotMatch(sparqlSection, /requestUrl\(\{/);
  });
});
