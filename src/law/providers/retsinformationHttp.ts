import type {
  LawProviderHttpResponse,
  LawProviderHttpTransport,
} from "../httpTransport";

const MAX_TOTAL_ATTEMPTS = 4;
const FALLBACK_DELAYS_MS = [500, 1000, 2000] as const;

export interface RetsinformationRetryOptions {
  headers?: Record<string, string>;
  sleep?: (ms: number) => Promise<void>;
}

export type RetsinformationFetchFn = LawProviderHttpTransport;

function defaultSleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function retryAfterDelay(response: LawProviderHttpResponse, attempt: number): number {
  const retryAfter = Object.entries(response.headers ?? {}).find(
    ([name]) => name.toLowerCase() === "retry-after",
  )?.[1]?.trim();
  if (retryAfter !== undefined && /^\d+$/.test(retryAfter)) {
    const seconds = Number(retryAfter);
    if (Number.isSafeInteger(seconds)) return seconds * 1000;
  }
  return FALLBACK_DELAYS_MS[attempt - 1];
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || status === 503;
}

export async function requestRetsinformationWithRetry(
  fetchFn: RetsinformationFetchFn,
  url: string,
  options: RetsinformationRetryOptions = {},
): Promise<LawProviderHttpResponse> {
  const sleep = options.sleep ?? defaultSleep;
  const fetchOptions = options.headers ? { headers: options.headers } : undefined;

  for (let attempt = 1; attempt <= MAX_TOTAL_ATTEMPTS; attempt += 1) {
    let response: LawProviderHttpResponse;
    try {
      response = await fetchFn(url, fetchOptions);
    } catch (error) {
      if (attempt === MAX_TOTAL_ATTEMPTS) throw error;
      await sleep(FALLBACK_DELAYS_MS[attempt - 1]);
      continue;
    }

    if (!isRetryableStatus(response.status) || attempt === MAX_TOTAL_ATTEMPTS) {
      return response;
    }

    await sleep(retryAfterDelay(response, attempt));
  }

  throw new Error("unreachable");
}
