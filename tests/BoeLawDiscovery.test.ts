import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

interface CapturedRequest {
  url: string;
  options?: { headers?: Record<string, string> };
}

interface BoeDiscoveryResult {
  kind: "results" | "no-results";
  entries: Array<{
    jurisdiction: "ES";
    canonicalInput: string;
    title: string;
    aliases: readonly string[];
    sourceUrl: string;
  }>;
}

interface BoeLawDiscoveryLike {
  search(query: string): Promise<BoeDiscoveryResult>;
}

interface BoeLawDiscoveryConstructors {
  new (
    fetchFn: (url: string, options?: { headers?: Record<string, string> }) => Promise<{
      ok: boolean;
      status: number;
      json(): Promise<unknown>;
    }>,
    baseUrl?: string,
  ): BoeLawDiscoveryLike;
  UnavailableError: new (...args: never[]) => Error;
  MalformedResponseError: new (...args: never[]) => Error;
}

const discoveryModule = require("../src/law/providers/BoeLawDiscovery") as {
  BoeLawDiscovery: BoeLawDiscoveryConstructors;
  BoeLawDiscoveryUnavailableError: BoeLawDiscoveryConstructors["UnavailableError"];
  BoeLawDiscoveryMalformedResponseError: BoeLawDiscoveryConstructors["MalformedResponseError"];
};
const { BoeLawDiscovery, BoeLawDiscoveryUnavailableError, BoeLawDiscoveryMalformedResponseError } = discoveryModule;

const SEARCH_URL = "https://api.example/datosabiertos/api/legislacion-consolidada";

function makeResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ status: { code: "200", text: "ok" }, data }),
  };
}

function makeItem(index: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = `BOE-A-2024-${index}`;
  return {
    fecha_actualizacion: "20240912T101530Z",
    identificador: id,
    ambito: { codigo: "1", texto: "estatal" },
    departamento: { codigo: "7723", texto: "Jefatura del Estado" },
    rango: { codigo: "1300", texto: "Ley" },
    fecha_disposicion: "20240901",
    numero_oficial: `${index}/2024`,
    titulo: `Ley de prueba ${index}`,
    diario: "Boletín Oficial del Estado",
    fecha_publicacion: "20240902",
    diario_numero: "220",
    fecha_vigencia: "20240903",
    vigencia_agotada: "N",
    estado_consolidacion: { codigo: "3", texto: "Finalizado" },
    url_eli: `https://www.boe.es/eli/es/l/2024/09/01/${index}`,
    url_html_consolidada: `https://www.boe.es/buscar/act.php?id=${id}`,
    ...overrides,
  };
}

function discoveryWithResponse(
  data: unknown,
  status = 200,
  requests: CapturedRequest[] = [],
): BoeLawDiscoveryLike {
  return new BoeLawDiscovery(
    async (url, options) => {
      requests.push({ url, options });
      return makeResponse(data, status);
    },
    SEARCH_URL,
  );
}

function emittedQuery(requests: CapturedRequest[]): string {
  const requestUrl = new URL(requests[0].url);
  const query = JSON.parse(requestUrl.searchParams.get("query") ?? "null") as {
    query?: { query_string?: { query?: string } };
  };
  return query.query?.query_string?.query ?? "";
}

describe("BOE law discovery", () => {
  it("binds every human title token to titulo", async () => {
    for (const [input, expected] of [
      ["Régimen Jurídico", "titulo:Régimen AND titulo:Jurídico"],
      ["Regimen Juridico", "titulo:Regimen AND titulo:Juridico"],
      ["Ley 40/2015", "titulo:Ley AND numero_oficial:40\\/2015"],
      ["ley 40", "titulo:ley AND titulo:40*"],
    ] as const) {
      const requests: CapturedRequest[] = [];
      const discovery = discoveryWithResponse("", 200, requests);

      await discovery.search(input);

      assert.equal(emittedQuery(requests), expected, input);
    }
  });

  it("routes complete numbers and preserves query escaping", async () => {
    const cases = [
      ["ley", "titulo:ley"],
      ["40/2015", "numero_oficial:40\\/2015"],
      ["  Régimen   Jurídico  ", "titulo:Régimen AND titulo:Jurídico"],
      ["Ley (40)", "titulo:Ley AND titulo:\\(40\\)"],
      ["ley texto", "titulo:ley AND titulo:texto"],
      ["ley 40/2015", "titulo:ley AND numero_oficial:40\\/2015"],
    ] as const;

    for (const [input, expected] of cases) {
      const requests: CapturedRequest[] = [];
      const discovery = discoveryWithResponse("", 200, requests);

      await discovery.search(input);

      assert.equal(emittedQuery(requests), expected, input);
    }
  });

  it("uses the authoritative list API and preserves the BOE identity fields", async () => {
    const requests: CapturedRequest[] = [];
    const discovery = discoveryWithResponse([makeItem(1, {
      identificador: "BOE-A-2015-10566",
      titulo: "Ley 40/2015, de 1 de octubre, de Régimen Jurídico del Sector Público.",
      url_html_consolidada: "https://www.boe.es/buscar/act.php?id=BOE-A-2015-10566",
    })], 200, requests);

    const result = await discovery.search("regimen");

    assert.equal(requests.length, 1);
    const requestUrl = new URL(requests[0].url);
    assert.equal(requestUrl.searchParams.get("offset"), "0");
    assert.equal(requestUrl.searchParams.get("limit"), "8");
    assert.equal(requests[0].options?.headers?.Accept, "application/json");
    assert.equal(emittedQuery(requests), "titulo:regimen");

    assert.equal(result.kind, "results");
    assert.deepEqual(result.entries, [{
      jurisdiction: "ES",
      canonicalInput: "BOE-A-2015-10566",
      title: "Ley 40/2015, de 1 de octubre, de Régimen Jurídico del Sector Público.",
      aliases: ["BOE-A-2015-10566"],
      sourceUrl: "https://www.boe.es/buscar/act.php?id=BOE-A-2015-10566",
    }]);
  });

  it("does not call BOE below the two-character query threshold", async () => {
    let calls = 0;
    const discovery = new BoeLawDiscovery(async () => {
      calls += 1;
      return makeResponse([]);
    }, SEARCH_URL);

    const result = await discovery.search(" r ");

    assert.equal(calls, 0);
    assert.deepEqual(result, { kind: "no-results", entries: [] });
  });

  it("caps authoritative results at eight entries", async () => {
    const discovery = discoveryWithResponse(Array.from({ length: 10 }, (_, index) => makeItem(index + 1)));

    const result = await discovery.search("ley");

    assert.equal(result.kind, "results");
    assert.equal(result.entries.length, 8);
  });

  it("deduplicates repeated canonical BOE IDs", async () => {
    const duplicate = makeItem(1, { titulo: "First authoritative title" });
    const discovery = discoveryWithResponse([
      duplicate,
      { ...duplicate, titulo: "Second duplicate title" },
    ]);

    const result = await discovery.search("title");

    assert.equal(result.kind, "results");
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].title, "First authoritative title");
  });

  it("fails closed on a malformed BOE ID", async () => {
    const discovery = discoveryWithResponse([makeItem(1, { identificador: "BOE-2015-10566" })]);

    await assert.rejects(
      discovery.search("ley"),
      (error: unknown) => error instanceof BoeLawDiscoveryMalformedResponseError,
    );
  });

  it("fails closed when the authoritative title is missing", async () => {
    const discovery = discoveryWithResponse([makeItem(1, { titulo: "   " })]);

    await assert.rejects(
      discovery.search("ley"),
      (error: unknown) => error instanceof BoeLawDiscoveryMalformedResponseError,
    );
  });

  it("distinguishes an authoritative empty result from source unavailability", async () => {
    const empty = discoveryWithResponse({});
    assert.deepEqual(await empty.search("ley"), { kind: "no-results", entries: [] });

    const unavailable = discoveryWithResponse([], 503);
    await assert.rejects(
      unavailable.search("ley"),
      (error: unknown) => error instanceof BoeLawDiscoveryUnavailableError,
    );
  });

  it("treats the BOE empty-string data response as no results", async () => {
    const empty = discoveryWithResponse("");

    assert.deepEqual(await empty.search("ley 40"), { kind: "no-results", entries: [] });
  });

  it("distinguishes a malformed response from no results", async () => {
    const malformed = new BoeLawDiscovery(
      async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: { code: "200", text: "ok" }, data: "not-an-array" }),
      }),
      SEARCH_URL,
    );

    await assert.rejects(
      malformed.search("ley"),
      (error: unknown) => error instanceof BoeLawDiscoveryMalformedResponseError,
    );
  });

  it("keeps unexpected data values malformed", async () => {
    for (const data of ["not-an-array", " ", null, 42, false, { unexpected: true }]) {
      const discovery = discoveryWithResponse(data);

      await assert.rejects(
        discovery.search("ley"),
        (error: unknown) => error instanceof BoeLawDiscoveryMalformedResponseError,
      );
    }
  });

  it("rejects a non-authoritative consolidated URL", async () => {
    const discovery = discoveryWithResponse([makeItem(1, {
      url_html_consolidada: "https://example.test/law/BOE-A-2024-1",
    })]);

    await assert.rejects(
      discovery.search("ley"),
      (error: unknown) => error instanceof BoeLawDiscoveryMalformedResponseError,
    );
  });
});
