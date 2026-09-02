import { CELLAR_SPARQL_ENDPOINT } from "./providers/CellarMetadataClient";

export interface LawProviderHttpResponse {
  ok: boolean;
  status?: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export type LawProviderHttpTransport = (
  input: string,
  options?: { headers?: Record<string, string> },
) => Promise<LawProviderHttpResponse>;

interface RequestUrlParamLike {
  url: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
  throw?: boolean;
}

interface RequestUrlResponseLike {
  status: number;
  text: string;
  json: unknown;
}

export type RequestUrlLike = (
  request: RequestUrlParamLike | string,
) => Promise<RequestUrlResponseLike>;

export function createObsidianRequestUrlTransport(
  requestUrl: RequestUrlLike,
): LawProviderHttpTransport {
  return async (url, options) => {
    const request = options?.headers
      ? {
          url,
          method: "GET",
          headers: options.headers,
          throw: false,
        }
      : {
          url,
          method: "GET",
          throw: false,
        };

    const response = await requestUrl(request);

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => response.text,
      json: async () => response.json,
    };
  };
}

export const CELLAR_RETRYABLE_HTTP_STATUSES: readonly number[] = [429, 500, 502, 503, 504];
export const CELLAR_MAX_TOTAL_HTTP_ATTEMPTS = 4;
export const CELLAR_HTTP_RETRY_BACKOFF_MS: readonly number[] = [500, 1000, 2000];

const CELLAR_SPARQL_JSON_ACCEPT = "application/sparql-results+json";

export function isRetryableCellarHttpStatus(status: number): boolean {
  return CELLAR_RETRYABLE_HTTP_STATUSES.indexOf(status) >= 0;
}

export class CellarHttpRequestError extends Error {
  constructor(
    readonly status: number,
    readonly attempts: number,
  ) {
    super(`CELLAR request failed with HTTP ${status} after ${attempts} attempt(s).`);
    this.name = "CellarHttpRequestError";
  }
}

export interface CellarRetryOptions {
  sleep?: (ms: number) => Promise<void>;
}

function defaultCellarRetrySleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function requestCellarWithRetry<TResponse extends { status: number }>(
  request: () => Promise<TResponse>,
  options: CellarRetryOptions = {},
): Promise<TResponse> {
  const sleep = options.sleep ?? defaultCellarRetrySleep;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= CELLAR_MAX_TOTAL_HTTP_ATTEMPTS; attempt += 1) {
    const backoffMs = CELLAR_HTTP_RETRY_BACKOFF_MS[attempt - 1];

    let response: TResponse;
    try {
      response = await request();
    } catch (error) {
      if (backoffMs === undefined) throw error;
      await sleep(backoffMs);
      continue;
    }

    if (response.status >= 200 && response.status < 300) return response;

    lastStatus = response.status;
    if (!isRetryableCellarHttpStatus(response.status)) {
      throw new CellarHttpRequestError(response.status, attempt);
    }

    if (backoffMs === undefined) break;
    await sleep(backoffMs);
  }

  throw new CellarHttpRequestError(lastStatus, CELLAR_MAX_TOTAL_HTTP_ATTEMPTS);
}

export function createCellarSparqlJsonFetcher(
  requestUrl: RequestUrlLike,
  options: CellarRetryOptions = {},
): (query: string) => Promise<unknown> {
  return async (query) => {
    const response = await requestCellarWithRetry(
      () =>
        requestUrl({
          url: `${CELLAR_SPARQL_ENDPOINT}?query=${encodeURIComponent(query)}`,
          method: "GET",
          headers: { Accept: CELLAR_SPARQL_JSON_ACCEPT },
          throw: false,
        }),
      options,
    );

    return response.json as unknown;
  };
}

export function createObsidianRequestUrlPostTransport(
  requestUrl: RequestUrlLike,
): (url: string, body: string) => Promise<LawProviderHttpResponse> {
  return async (url, body) => {
    const response = await requestUrl({
      url,
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/json",
      },
      throw: false,
    });

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      text: async () => response.text,
      json: async () => response.json,
    };
  };
}
