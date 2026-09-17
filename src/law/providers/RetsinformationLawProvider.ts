import type { LawProvider } from "../LawProvider";
import { LawProviderUnavailableError } from "../errors";
import type { LawReference, LawSection } from "../types";
import { parseDkCanonicalEli } from "./retsinformationIdentity";
import {
  requestRetsinformationWithRetry,
  type RetsinformationFetchFn,
} from "./retsinformationHttp";
import {
  findLexDaniaReference,
  parseLexDaniaXml,
  type LexDaniaChangeEvidence,
} from "./retsinformationLexDania";

const DEFAULT_ORIGIN = "https://www.retsinformation.dk";
const SUPPORTED_DOCUMENT_TYPES = new Set(["LOV", "LOVH", "LBK", "LBKH"]);

export interface RetsinformationCurrentnessObservation {
  canonicalEli: string;
  documentType: string | null;
  documentDate: string | null;
  sourceStatus: string | null;
  changes: readonly LexDaniaChangeEvidence[];
  observedAt: string;
}

export interface RetsinformationCurrentnessRecorder {
  record(observation: RetsinformationCurrentnessObservation): Promise<void> | void;
}

export class RetsinformationLawProvider implements LawProvider {
  readonly id = "retsinformation";
  readonly label = "Retsinformation";

  constructor(
    private readonly fetchFn: RetsinformationFetchFn,
    private readonly recorder?: RetsinformationCurrentnessRecorder,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly origin = DEFAULT_ORIGIN,
  ) {}

  async getSection(reference: LawReference): Promise<LawSection | null> {
    if (reference.jurisdiction !== "DK" || reference.referenceType !== "section") return null;
    if (reference.language !== undefined && reference.language !== "da") return null;
    if (reference.sourceVariant !== undefined) return null;

    const identity = parseDkCanonicalEli(reference.lawCode);
    if (!identity || identity.pubMedia !== "lta") return null;

    const url = `${this.origin}${identity.canonicalEli}/xml`;
    let response;
    try {
      response = await requestRetsinformationWithRetry(this.fetchFn, url);
    } catch (error) {
      throw new LawProviderUnavailableError(this.id, `Retsinformation request failed: ${url}`, error);
    }

    if (response.status === 404) return null;
    if (response.status === undefined || response.status < 200 || response.status >= 300) {
      throw new LawProviderUnavailableError(this.id, `Retsinformation request failed: ${url}`);
    }

    let body: string;
    try {
      body = await response.text();
    } catch (error) {
      throw new LawProviderUnavailableError(this.id, `Retsinformation response failed: ${url}`, error);
    }

    const document = parseLexDaniaXml(body);
    if (!document) return null;
    if (document.metadata.year !== identity.year || document.metadata.number !== identity.number) return null;
    if (document.metadata.documentTitle === null) return null;
    if (document.metadata.documentType === null || !SUPPORTED_DOCUMENT_TYPES.has(document.metadata.documentType)) return null;

    const extracted = findLexDaniaReference(document, reference.section, reference.subsection);
    if (!extracted) return null;

    const retrievedAt = this.now();
    const section: LawSection = {
      providerId: this.id,
      providerLabel: this.label,
      sourceUrl: `${this.origin}${identity.canonicalEli}`,
      lawCode: identity.canonicalEli,
      lawTitle: document.metadata.documentTitle,
      section: reference.section,
      referenceType: "section",
      jurisdiction: "DK",
      language: "da",
      ...(reference.subsection === undefined ? {} : { subsection: reference.subsection }),
      text: extracted.text,
      retrievedAt,
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: true,
    };

    if (this.recorder) {
      try {
        await this.recorder.record({
          canonicalEli: identity.canonicalEli,
          documentType: document.metadata.documentType,
          documentDate: document.metadata.diesSigni,
          sourceStatus: document.metadata.status,
          changes: document.changes,
          observedAt: retrievedAt,
        });
      } catch {
        // Currentness recording is ancillary; verified legal text remains usable.
      }
    }

    return section;
  }
}
