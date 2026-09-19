import type { LawProviderHttpTransport } from "../httpTransport";
import {
  parseRetsinformationJsonLd,
  type RetsinformationIndex,
  type RetsinformationIndexEntry,
} from "./RetsinformationDiscoveryIndex";
import type {
  RetsinformationBootstrapCheckpoint,
  RetsinformationDiscoveryIndexStorage,
} from "./RetsinformationDiscoveryIndexStorage";
import { enumerateRetsinformationSitemap } from "./RetsinformationSitemap";
import { requestRetsinformationWithRetry } from "./retsinformationHttp";

export type RetsinformationBootstrapStorage = Pick<
  RetsinformationDiscoveryIndexStorage,
  "loadBootstrapCheckpoint" | "saveBootstrapCheckpoint" | "saveCandidate" |
  "activateCandidate" | "clearBootstrapCheckpoint" | "loadActive"
>;

export interface RetsinformationBootstrapOptions {
  now?: () => string;
  sleep?: (ms: number) => Promise<void>;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function metadataUrl(canonicalEli: string): string {
  return `https://www.retsinformation.dk${canonicalEli}.json`;
}

function sameIndex(left: RetsinformationIndex, right: RetsinformationIndex): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function bootstrapRetsinformationIndex(
  storage: RetsinformationBootstrapStorage,
  fetchFn: LawProviderHttpTransport,
  options: RetsinformationBootstrapOptions = {},
): Promise<RetsinformationIndex> {
  const now = options.now ?? defaultNow;
  const retryOptions = options.sleep ? { sleep: options.sleep } : undefined;
  let checkpoint: RetsinformationBootstrapCheckpoint | null = await storage.loadBootstrapCheckpoint();

  if (!checkpoint) {
    const sitemapEntries = await enumerateRetsinformationSitemap(fetchFn, retryOptions);
    checkpoint = {
      schemaVersion: 1,
      startedAt: now(),
      sitemapEntries,
      nextEntryIndex: 0,
      validatedEntries: [],
    };
    await storage.saveBootstrapCheckpoint(checkpoint);
  }

  for (let i = checkpoint.nextEntryIndex; i < checkpoint.sitemapEntries.length; i += 1) {
    const sitemapEntry = checkpoint.sitemapEntries[i];
    const response = await requestRetsinformationWithRetry(
      fetchFn,
      metadataUrl(sitemapEntry.canonicalEli),
      retryOptions,
    );
    if (!response.ok) {
      throw new Error(`failed to fetch metadata for ${sitemapEntry.canonicalEli}: HTTP ${response.status}`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      void error;
      throw new Error(`failed to parse metadata for ${sitemapEntry.canonicalEli}`);
    }

    const parsed = parseRetsinformationJsonLd(json, sitemapEntry.canonicalEli, now());
    if (!parsed) {
      throw new Error(`metadata validation failed for ${sitemapEntry.canonicalEli}`);
    }

    const entry: RetsinformationIndexEntry = {
      ...parsed,
      sitemapLastModified: sitemapEntry.sitemapLastModified,
    };
    checkpoint = {
      ...checkpoint,
      nextEntryIndex: i + 1,
      validatedEntries: [...checkpoint.validatedEntries, entry],
    };
    await storage.saveBootstrapCheckpoint(checkpoint);
  }

  if (checkpoint.nextEntryIndex !== checkpoint.sitemapEntries.length) {
    throw new Error("Retsinformation bootstrap checkpoint is incomplete.");
  }

  const completedAt = now();
  const candidate: RetsinformationIndex = {
    schemaVersion: 1,
    source: "retsinformation-eli",
    generatedAt: completedAt,
    lastSuccessfulRefresh: completedAt,
    lastSuccessfulIncrementalRefresh: null,
    lastSuccessfulFullReconciliation: null,
    feedWatermark: null,
    entries: checkpoint.validatedEntries,
  };

  await storage.saveCandidate(candidate);
  await storage.activateCandidate(candidate);
  await storage.clearBootstrapCheckpoint();

  const active = await storage.loadActive();
  if (!active || !sameIndex(active, candidate)) {
    throw new Error("Retsinformation bootstrap activation did not produce the completed index.");
  }
  return active;
}
