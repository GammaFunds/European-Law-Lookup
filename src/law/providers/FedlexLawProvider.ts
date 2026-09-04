import type { LawProvider } from "../LawProvider";
import type { LawProviderHttpResponse } from "../httpTransport";
import type { LawReference, LawSection } from "../types";
import {
  buildFedlexQueryBody,
  extractFedlexArticleFromResponse,
  mapFedlexReference,
  mapFedlexToLawSection,
} from "./fedlexMapping";

const FEDLEX_BASE_URL = "https://www.fedlex.admin.ch";

type FedlexHttpTransport = (
  url: string,
  body: string,
) => Promise<LawProviderHttpResponse>;

export class FedlexLawProvider implements LawProvider {
  readonly id = "fedlex";
  readonly label = "Fedlex / Bundesrecht der Schweiz";

  constructor(
    private readonly baseUrl = FEDLEX_BASE_URL,
    private readonly fetchFn: FedlexHttpTransport,
  ) {}

  async getSection(reference: LawReference): Promise<LawSection | null> {
    const query = mapFedlexReference(reference);
    if (!query) {
      return null;
    }

    const queryBody = buildFedlexQueryBody(
      query.workUri,
      query.articleNumber,
      query.language,
    );
    const searchUrl = `${this.baseUrl}/elasticsearch/proxy/_search?index=data`;

    let response: LawProviderHttpResponse;
    try {
      response = await this.fetchFn(searchUrl, JSON.stringify(queryBody));
    } catch {
      return null;
    }

    if (response.status === 404 || !response.ok) {
      return null;
    }

    let responseJson: unknown;
    try {
      responseJson = await response.json();
    } catch {
      return null;
    }

    const articleData = extractFedlexArticleFromResponse(responseJson, query.language);
    if (!articleData) {
      return null;
    }

    return mapFedlexToLawSection({
      reference,
      articleData,
      providerId: this.id,
      providerLabel: this.label,
      retrievedAt: new Date().toISOString(),
    });
  }
}
