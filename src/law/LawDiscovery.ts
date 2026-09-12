import type { LawMetadataSearchEntry } from "./lawMetadataSearch";
import type { LawJurisdiction } from "./types";

export interface LawDiscoveryResult {
  kind: "results" | "no-results";
  entries: LawMetadataSearchEntry[];
}

export interface LawDiscoveryProvider {
  jurisdiction: LawJurisdiction;
  sourceLabel: string;
  search(query: string): Promise<LawDiscoveryResult>;
}

export class LawDiscoveryUnavailableError extends Error {}

export class LawDiscoveryMalformedResponseError extends Error {}

export type LawDiscoveryStatus = "no-results" | "unavailable" | "malformed";

export function classifyLawDiscoveryError(error: unknown): LawDiscoveryStatus {
  return error instanceof LawDiscoveryMalformedResponseError ? "malformed" : "unavailable";
}
