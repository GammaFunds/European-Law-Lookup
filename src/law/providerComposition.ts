import type { LawProvider } from "./LawProvider";
import {
  createObsidianRequestUrlPostTransport,
  type LawProviderHttpTransport,
  type RequestUrlLike,
} from "./httpTransport";
import { FedlexLawProvider } from "./providers/FedlexLawProvider";
import { GesetzeImInternetProvider } from "./providers/GesetzeImInternetProvider";
import { MockLawProvider } from "./providers/MockLawProvider";
import { NeurisLawProvider } from "./providers/NeurisLawProvider";
import { RisLawProvider } from "./providers/RisLawProvider";
import { EurLexLawProvider } from "./providers/EurLexLawProvider";
import type { EuActLanguageAuthorizer } from "./providers/eurLexMapping";

export interface ProviderCompositionOptions {
  enableMockLawProvider?: boolean;
  httpTransport?: LawProviderHttpTransport;
  requestUrl?: RequestUrlLike;
  euActLanguageAuthorizer?: EuActLanguageAuthorizer;
}

export function buildLawProviders(options: ProviderCompositionOptions = {}): LawProvider[] {
  const httpTransport = options.httpTransport ?? createMissingHttpTransport();
  const fedlexTransport = options.requestUrl
    ? createObsidianRequestUrlPostTransport(options.requestUrl)
    : createMissingPostTransport();

  const providers: LawProvider[] = [
    new EurLexLawProvider(httpTransport, options.euActLanguageAuthorizer),
    new FedlexLawProvider(undefined, fedlexTransport),
    new NeurisLawProvider(undefined, httpTransport),
    new GesetzeImInternetProvider(undefined, httpTransport),
    new RisLawProvider(undefined, httpTransport),
  ];

  if (options.enableMockLawProvider === true) {
    providers.push(new MockLawProvider());
  }

  return providers;
}

function createMissingHttpTransport(): LawProviderHttpTransport {
  return async () => {
    throw new Error("No HTTP transport configured");
  };
}

function createMissingPostTransport() {
  return async (_url: string, _body: string) => {
    throw new Error("No requestUrl transport configured for Fedlex");
  };
}
