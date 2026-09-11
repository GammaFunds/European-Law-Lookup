import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { LawProviderUnavailableError } from "../src/law/errors";
import { CachedLawProvider, InMemoryLawSectionCache } from "../src/law/LawSectionCache";
import { BoeLawProvider } from "../src/law/providers/BoeLawProvider";

const ID = "BOE-A-2015-10566";
const metadata = {
  data: [{
    identificador: ID,
    titulo: "Ley 40/2015, de 1 de octubre, de Régimen Jurídico del Sector Público.",
    url_html_consolidada: `https://www.boe.es/buscar/act.php?id=${ID}`,
    url_eli: "https://www.boe.es/eli/es/l/2015/10/01/40",
  }],
};
const ELI_WORK = "https://www.boe.es/eli/es/l/2015/10/01/40";
const RECORD_URL = `https://www.boe.es/buscar/act.php?id=${ID}`;
const recordPage = (permalinks: string[] = [`${ELI_WORK}/con`]) => `<html><body><dl><dt>Permalink ELI:</dt>${permalinks.map((permalink) => `<dd><a href="${permalink}">${permalink}</a></dd>`).join("")}</dl></body></html>`;
// Captured from the official BOE metadata-eli endpoint on 2026-09-09.
// The fixture keeps the production response/data/metadata-eli/rdf:RDF wrapper
// and includes the original and consolidated LegalResource members.
const eli = `<response><status><code>200</code><text>ok</text></status><data><metadata-eli><rdf:RDF><eli:LegalResource rdf:about="${ELI_WORK}"><eli:has_member><eli:LegalResource rdf:about="${ELI_WORK}/con/20240802"><eli:id_local rdf:datatype="http://www.w3.org/2001/XMLSchema#string">${ID}</eli:id_local><eli:version rdf:resource="http://www.elidata.es/mdr/authority/version/con"/><eli:version_date rdf:datatype="http://www.w3.org/2001/XMLSchema#date">2024-08-02</eli:version_date><eli:is_member_of rdf:resource="${ELI_WORK}"/><eli:is_realized_by><eli:LegalExpression rdf:about="${ELI_WORK}/con/20240802/spa"><eli:language rdf:resource="http://www.elidata.es/mdr/authority/language/spa"/><eli:realizes rdf:resource="${ELI_WORK}/con/20240802"/></eli:LegalExpression></eli:is_realized_by></eli:LegalResource></eli:has_member></eli:LegalResource></rdf:RDF></metadata-eli></data></response>`;
const eliWithNestedResources = eli.replace(
  "</eli:LegalResource></rdf:RDF>",
  `<eli:has_member><eli:LegalResource rdf:about="${ELI_WORK}/con/20250115"><eli:id_local>${ID}</eli:id_local><eli:version_date>2025-01-15</eli:version_date><eli:is_member_of rdf:resource="${ELI_WORK}"/><eli:is_realized_by><eli:LegalExpression rdf:about="${ELI_WORK}/con/20250115/spa"><eli:language rdf:resource="http://www.elidata.es/mdr/authority/language/spa"/><eli:realizes rdf:resource="${ELI_WORK}/con/20250115"/></eli:LegalExpression></eli:is_realized_by></eli:LegalResource></eli:has_member></eli:LegalResource></rdf:RDF>`,
);
const index = {
  data: [{ bloque: [
    { id: "a1", titulo: "Artículo 1" },
    { id: "a103", titulo: "Artículo 103" },
    { id: "a172ter", titulo: "Art 172 ter" },
  ] }],
};
const block = (id: string, versions: string) => {
  const title = id === "a1" ? "1" : id === "a103" ? "103" : "172 ter";
  // Captured from the official BOE block endpoint on 2026-09-09.
  return `<response><status><code>200</code><text>ok</text></status><data><bloque id="${id}" tipo="precepto" titulo="Artículo ${title}">${versions.replace(/Artículo 1/g, `Artículo ${title}`)}</bloque></data></response>`;
};
const structuralBlock = (id: string, tipo: string, titulo = "") =>
  `<response><status><code>200</code><text>ok</text></status><data><bloque id="${id}" tipo="${tipo}" titulo="${titulo}"><version id_norma="${ID}" fecha_publicacion="2024-08-02" fecha_vigencia="2024-08-02"><p class="textoCompleto">structural block</p></version></bloque></data></response>`;
const version = (date: string, text: string, id = "BOE-A-2015-10566") => `<version id_norma="${id}" fecha_vigencia="${date}" fecha_publicacion="${date}"><p class="articulo">Artículo 1</p><p class="parrafo">${text}</p><blockquote><p class="nota_pie">Texto editorial de modificación</p></blockquote></version>`;

function response(body: unknown, status = 200, xml = false) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
    headers: xml ? { "content-type": "application/xml" } : { "content-type": "application/json" },
  };
}

function providerWith(routes: Record<string, ReturnType<typeof response>>) {
  const calls: string[] = [];
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const provider = new BoeLawProvider("https://api.example/legislacion-consolidada", async (url, options) => {
    calls.push(url);
    requests.push({ url, headers: { ...(options?.headers ?? {}) } });
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!route && url === RECORD_URL) return response(recordPage());
    if (!route) throw new Error(`unexpected request: ${url}`);
    return route[1];
  });
  return { provider, calls, requests };
}

describe("BoeLawProvider", () => {
  it("rejects truthy non-string required metadata fields at the metadata boundary", () => {
    for (const field of ["titulo", "url_html_consolidada", "url_eli"] as const) {
      const malformed = {
        ...metadata.data[0],
        [field]: field === "titulo" ? { unexpected: true } : 42,
      };
      const { provider } = providerWith({});
      const parseMetadata = (provider as unknown as {
        parseMetadata(value: unknown, requestedId: string): unknown;
      }).parseMetadata.bind(provider);

      assert.throws(
        () => parseMetadata({ data: [malformed] }, ID),
        /Malformed or incomplete BOE metadata/u,
        field,
      );
    }
  });

  it("rejects a consolidated record URL that is not the exact BOE URL for the requested ID", () => {
    for (const url_html_consolidada of [
      "http://www.boe.es/buscar/act.php?id=BOE-A-2015-10566",
      "https://example.test/buscar/act.php?id=BOE-A-2015-10566",
      "https://www.boe.es/buscar/act.php?id=BOE-A-2015-10565",
      "not-a-url",
      "https://www.boe.es/buscar/act.php?id=BOE-A-2015-10566&extra=1",
    ]) {
      const { provider } = providerWith({});
      const parseMetadata = (provider as unknown as {
        parseMetadata(value: unknown, requestedId: string): unknown;
      }).parseMetadata.bind(provider);

      assert.throws(
        () => parseMetadata({ data: [{ ...metadata.data[0], url_html_consolidada }] }, ID),
        /Malformed or incomplete BOE metadata/u,
        url_html_consolidada,
      );
    }
  });

  it("accepts the current BOE work plus consolidated /con permalink shape", async () => {
    const { provider, calls, requests } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "bound")), 200, true),
    });

    await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });

    assert.equal(calls[0], `https://api.example/legislacion-consolidada/id/${ID}/metadatos`);
    assert.equal(calls[1], RECORD_URL);
    assert.deepEqual(requests.map(({ url, headers }) => ({
      path: new URL(url).pathname,
      accept: headers.Accept,
    })), [
      { path: `/legislacion-consolidada/id/${ID}/metadatos`, accept: "application/json" },
      { path: `/buscar/act.php`, accept: "text/html" },
      { path: `/legislacion-consolidada/id/${ID}/metadata-eli`, accept: "application/xml" },
      { path: `/legislacion-consolidada/id/${ID}/texto/indice`, accept: "application/json" },
      { path: `/legislacion-consolidada/id/${ID}/texto/bloque/a1`, accept: "application/xml" },
    ]);
  });

  it("traverses nested ELI resources in document order without skipping matches", async () => {
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eliWithNestedResources, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2025-01-15", "nested resource")), 200, true),
    });

    const section = await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.equal(section?.validFrom, "2025-01-15");
  });

  it("accepts the live compact BOE effective-date format", async () => {
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(
        block("a1", version("20161002", "compact date text")), 200, true,
      ),
    });
    const section = await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.equal(section?.validFrom, "2016-10-02");
    assert.match(section?.text ?? "", /compact date text/);
  });

  it("resolves Article 1 through a production-shaped blank-title structural index entry", async () => {
    const { provider, calls } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response({
        data: [{ bloque: [{ id: "co", titulo: "" }, { id: "a1", titulo: "Artículo 1. Objeto." }] }],
      }),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(
        block("a1", version("2024-08-02", "Article 1 text")), 200, true,
      ),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/co`]: response(
        structuralBlock("co", "encabezado"), 200, true,
      ),
    });

    const section = await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.equal(section?.text, "Article 1 text");
    assert.deepEqual(
      calls.filter((url) => url.includes("/texto/bloque/")),
      [
        `https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/co`,
        `https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`,
      ],
    );
  });

  it("accepts a production-shaped non-precepto block with an absent title", async () => {
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response({
        data: [{ bloque: [{ id: "co", titulo: "" }, { id: "a1", titulo: "Artículo 1. Objeto." }] }],
      }),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/co`]: response(
        structuralBlock("co", "encabezado").replace(' titulo=""', ""),
        200,
        true,
      ),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(
        block("a1", version("2024-08-02", "Article 1 after absent-title classification")),
        200,
        true,
      ),
    });

    const section = await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.equal(section?.text, "Article 1 after absent-title classification");
  });

  it("rejects blank-title entries that cannot be authoritatively classified as structural", async () => {
    for (const [classifiedBlock, expectedBlockId] of [
      [structuralBlock("co", "precepto"), "co"],
      [structuralBlock("co", "precepto").replace(' titulo=""', ""), "co"],
      [structuralBlock("other", "encabezado"), "co"],
      [structuralBlock("co", ""), "co"],
      [structuralBlock("co", "not-a-boe-type"), "co"],
      [structuralBlock("co", "encabezado", "Artículo 1"), "co"],
    ] as const) {
      const { provider, calls } = providerWith({
        [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
        [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
        [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response({
          data: [{ bloque: [{ id: "co", titulo: "" }, { id: "a1", titulo: "Artículo 1. Objeto." }] }],
        }),
        [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/${expectedBlockId}`]: response(
          classifiedBlock,
          200,
          true,
        ),
      });

      await assert.rejects(
        provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
        LawProviderUnavailableError,
      );
      assert.equal(calls.some((url) => url.endsWith("/texto/bloque/a1")), false);
    }
  });

  it("rejects duplicate structural IDs and duplicate matching Article 1 candidates globally", async () => {
    for (const duplicateIndex of [
      { data: [{ bloque: [{ id: "co", titulo: "" }, { id: "co", titulo: "" }, { id: "a1", titulo: "Artículo 1" }] }] },
      { data: [{ bloque: [{ id: "a1", titulo: "Artículo 1" }, { id: "a1b", titulo: "Artículo 1. Otra candidate" }] }] },
    ]) {
      const { provider, calls } = providerWith({
        [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
        [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
        [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(duplicateIndex),
        [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/co`]: response(
          structuralBlock("co", "encabezado"),
          200,
          true,
        ),
      });

      await assert.rejects(
        provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
        LawProviderUnavailableError,
      );
      assert.equal(calls.some((url) => url.includes("/texto/bloque/")), false);
    }
  });

  it("rejects a foreign official-page permalink before index or block retrieval", async () => {
    const { provider, calls } = providerWith({
      [RECORD_URL]: response(recordPage(["https://www.boe.es/eli/es/l/2015/10/01/39/con"])),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
    });

    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
    assert.equal(calls.some((url) => url.includes("/texto/indice") || url.includes("/texto/bloque/")), false);
  });

  it("does not convert an official-page identity failure into a cached BOE result", async () => {
    const { provider, calls } = providerWith({
      [RECORD_URL]: response(recordPage(["https://www.boe.es/eli/es/l/2015/10/01/39/con"])),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
    });
    const cache = new InMemoryLawSectionCache();
    await cache.set({
      providerId: "boe",
      providerLabel: "BOE",
      lawCode: ID,
      lawTitle: metadata.data[0].titulo,
      section: "1",
      jurisdiction: "ES",
      text: "stale identity fallback",
      retrievedAt: "2026-09-09T00:00:00.000Z",
      cacheStatus: "live",
      isOfficialSource: true,
      isAuthoritativeText: false,
    });

    const cachedProvider = new CachedLawProvider(provider, cache, {
      allowedProviderIds: ["boe"],
      now: () => new Date("2026-09-09T00:00:01.000Z"),
    });
    await assert.rejects(
      cachedProvider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
    assert.equal(calls.some((url) => url.includes("/texto/indice") || url.includes("/texto/bloque/")), false);
  });

  it("extracts exactly one canonical Permalink ELI from a page with extraneous definition-list noise", async () => {
    const noisyRecord = `<html><body>
      <dl>
        <dt>Permalink ELI:</dt>
        <dd><a href="${ELI_WORK}/con">${ELI_WORK}/con</a></dd>
        <dt>Otra definición:</dt>
        <dd><a href="https://www.boe.es/otro/enlace">enlace</a></dd>
        <dt>Fecha:</dt>
        <dd>2024-08-02</dd>
      </dl>
    </body></html>`;
    const { provider } = providerWith({
      [RECORD_URL]: response(noisyRecord),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "noisy record text")), 200, true),
    });
    const section = await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.match(section?.text ?? "", /noisy record text/);
  });

  it("rejects missing, duplicate, conflicting, and malformed official-page permalinks", async () => {
    for (const page of [
      "<html><body>Permalink ELI:</body></html>",
      recordPage([ELI_WORK, ELI_WORK]),
      recordPage([`${ELI_WORK}/con`, "https://www.boe.es/eli/es/l/2015/10/01/39/con"]),
      recordPage([ELI_WORK]),
      recordPage([`${ELI_WORK}/con/spa`]),
      recordPage([`${ELI_WORK}/con?foo=bar`]),
      recordPage([`${ELI_WORK}/con#x`]),
      recordPage([`${ELI_WORK}/con/con`]),
      recordPage([`http://www.boe.es/eli/es/l/2015/10/01/40/con`]),
      recordPage([`https://boe.es/eli/es/l/2015/10/01/40/con`]),
    ]) {
      const { provider } = providerWith({
        [RECORD_URL]: response(page),
        [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
        [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      });
      await assert.rejects(
        provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
        LawProviderUnavailableError,
      );
    }
  });
  it("rejects a self-consistent foreign metadata and ELI identity pair", async () => {
    const foreignId = "BOE-A-2015-10565";
    const foreignWork = "https://www.boe.es/eli/es/l/2015/10/01/39";
    const foreignMetadata = { data: [{ ...metadata.data[0], url_eli: foreignWork }] };
    const foreignEli = eli
      .replace(/<eli:id_local[^>]*>BOE-A-2015-10566<\/eli:id_local>/, `<eli:id_local>${foreignId}</eli:id_local>`)
      .split(ELI_WORK).join(foreignWork);
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(foreignMetadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(foreignEli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "foreign pair")), 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("rejects a foreign metadata work even when ELI id_local names the requested act", async () => {
    const foreignWork = "https://www.boe.es/eli/es/l/2015/10/01/39";
    const foreignMetadata = { data: [{ ...metadata.data[0], url_eli: foreignWork }] };
    const foreignEli = eli.replace(`rdf:resource="${ELI_WORK}"`, `rdf:resource="${foreignWork}"`);
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(foreignMetadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(foreignEli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "foreign work")), 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("rejects a foreign ELI local identity with otherwise correct metadata", async () => {
    const foreignEli = eli.replace(/<eli:id_local[^>]*>BOE-A-2015-10566<\/eli:id_local>/, "<eli:id_local>BOE-A-2015-10565</eli:id_local>");
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(foreignEli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "foreign local identity")), 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("rejects duplicate required ELI identity elements", async () => {
    const duplicate = eli.replace(/<eli:id_local[^>]*>BOE-A-2015-10566<\/eli:id_local>/, `<eli:id_local>${ID}</eli:id_local><eli:id_local>${ID}</eli:id_local>`);
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(duplicate, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "duplicate ELI identity")), 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("rejects duplicate XML attributes", async () => {
    const duplicateAttribute = block("a1", version("2024-08-02", "duplicate attribute")).replace('id="a1"', 'id="a1" id="a1"');
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(duplicateAttribute, 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("rejects appended content after the closed block root", async () => {
    const appended = `${block("a1", version("2024-08-02", "appended content"))}<version id_norma="${ID}" fecha_vigencia="2024-08-02"><p class="parrafo">fake</p></version>`;
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(appended, 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("accepts a legitimate modifying-act id_norma inside the validated block", async () => {
    const modifyingAct = "BOE-A-2020-12345";
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "amended consolidated text", modifyingAct)), 200, true),
    });
    const section = await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.match(section?.text ?? "", /amended consolidated text/);
  });

  it("rejects a version nested outside the direct block version scope", async () => {
    const nested = `<bloque id="a1" tipo="precepto" titulo="Artículo 1"><contenedor><version id_norma="${ID}" fecha_vigencia="2024-08-02"><p class="articulo">Artículo 1</p><p class="parrafo">nested fake version</p></version></contenedor></bloque>`;
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(nested, 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("rejects a block whose article title does not match the requested normalized article", async () => {
    const wrongTitle = block("a1", version("2024-08-02", "wrong scope text")).replace('titulo="Artículo 1"', 'titulo="Artículo 103"');
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(wrongTitle, 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("rejects a selected article block with a non-precepto type", async () => {
    const wrongType = block("a1", version("2024-08-02", "wrong block type")).replace('tipo="precepto"', 'tipo="encabezado"');
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(wrongType, 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("rejects a block envelope with the wrong block ID", async () => {
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a103", version("2024-08-02", "wrong block ID")), 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("rejects a structurally required version with a malformed id_norma", async () => {
    const malformed = block("a1", version("2024-08-02", "malformed version identity").replace(`id_norma="${ID}"`, `id_norma="${ID}-foreign"`));
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(malformed, 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("preserves legitimate table, blockquote, and self-closing image markup", async () => {
    const rich = `<version id_norma="${ID}" fecha_vigencia="2024-08-02"><p class="articulo">Artículo 1</p><table><tr><td>Tabla normativa</td></tr></table><img src="seal.png"/><blockquote><p>Nota editorial</p></blockquote><p>Texto principal</p></version>`;
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", rich), 200, true),
    });
    const section = await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.match(section?.text ?? "", /Tabla normativa/);
    assert.match(section?.text ?? "", /Texto principal/);
    assert.doesNotMatch(section?.text ?? "", /Nota editorial/);
  });

  it("rejects duplicate XML declarations", async () => {
    const duplicateDeclaration = `<?xml version="1.0"?>${block("a1", version("2024-08-02", "duplicate declaration text"))}<?xml version="1.0"?>`;
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(duplicateDeclaration, 200, true),
    });
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects an ambiguous metadata envelope with multiple records", async () => {
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response({ data: [metadata.data[0], metadata.data[0]] }),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "ambiguous metadata text")), 200, true),
    });
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects mismatched XML tags instead of extracting plausible text", async () => {
    const malformed = `<bloque id="a1"><version id_norma="${ID}" fecha_vigencia="2024-08-02"><p class="articulo">Artículo 1</p><p class="parrafo">malformed but plausible text</div></version></bloque>`;
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(malformed, 200, true),
    });
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects conflicting duplicate block roots", async () => {
    const duplicate = `${block("a1", version("2023-01-01", "first root"))}${block("a1", version("2024-08-02", "second root"))}`;
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(duplicate, 200, true),
    });
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects truncated block XML", async () => {
    const truncated = `<bloque id="a1"><version id_norma="${ID}" fecha_vigencia="2024-08-02"><p class="articulo">Artículo 1</p><p class="parrafo">truncated`;
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(truncated, 200, true),
    });
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects an impossible ELI version date", async () => {
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli.replace("2024-08-02", "2024-02-30"), 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-02-30", "impossible ELI date text")), 200, true),
    });
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects a block version without an effective date", async () => {
    const publicationOnly = `<version id_norma="${ID}" fecha_publicacion="2024-08-02"><p class="articulo">Artículo 1</p><p class="parrafo">publication-only text</p></version>`;
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", publicationOnly), 200, true),
    });
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("excludes future effective versions while accepting the exact current boundary", async () => {
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(
        block("a1", `${version("2024-08-02", "boundary text")}${version("2025-01-01", "future text")}`), 200, true,
      ),
    });
    const section = await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.match(section?.text ?? "", /boundary text/);
    assert.doesNotMatch(section?.text ?? "", /future text/);
  });

  it("rejects an ELI expression bound to a different work", async () => {
    const foreignWork = "https://www.boe.es/eli/es/l/2015/10/01/39";
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(
        eli.split(ELI_WORK).join(foreignWork), 200, true,
      ),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "foreign ELI text")), 200, true),
    });
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects ELI metadata with missing identity", async () => {
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(
        eli.replace(`<eli:is_member_of rdf:resource="${ELI_WORK}"/>`, ""), 200, true,
      ),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "missing ELI identity text")), 200, true),
    });
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects malformed live ELI and block envelopes", async () => {
    const malformedEli = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(
        eli.replace("<metadata-eli>", "<metadata-eli-malformed>"), 200, true,
      ),
    });
    await assert.rejects(
      malformedEli.provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );

    const malformedBlock = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(
        block("a1", version("2024-08-02", "malformed envelope")).replace("<data>", "<payload>"), 200, true,
      ),
    });
    await assert.rejects(
      malformedBlock.provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects ambiguous consolidated expressions and foreign language expressions", async () => {
    const duplicateExpression = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(
        eli.replace(
          "</eli:LegalExpression>",
          `<eli:LegalExpression rdf:about="${ELI_WORK}/con/20240802/spa"><eli:language rdf:resource="http://www.elidata.es/mdr/authority/language/spa"/><eli:realizes rdf:resource="${ELI_WORK}/con/20240802"/></eli:LegalExpression>`,
        ), 200, true,
      ),
    });
    await assert.rejects(
      duplicateExpression.provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );

    const foreignLanguage = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(
        eli.replace("authority/language/spa", "authority/language/cat"), 200, true,
      ),
    });
    await assert.rejects(
      foreignLanguage.provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects a future-only block version instead of returning it", async () => {
    const futureOnly = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(
        block("a1", version("2999-01-01", "future-only text")), 200, true,
      ),
    });
    await assert.rejects(
      futureOnly.provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("maps a thrown transport failure to provider unavailable", async () => {
    const provider = new BoeLawProvider(
      "https://api.example/legislacion-consolidada",
      async () => { throw new Error("socket closed"); },
    );
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects malformed ELI identity", async () => {
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(
        eli.replace(`rdf:resource="${ELI_WORK}"`, `rdf:resource="not-an-eli-work"`), 200, true,
      ),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "malformed ELI identity text")), 200, true),
    });
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("accepts an ELI expression bound to the requested work", async () => {
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "Texto del artículo 1.")), 200, true),
    });
    const section = await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.match(section?.text ?? "", /Texto del artículo 1/);
  });

  it("uses metadata, ELI, index, and the index-provided block ID", async () => {
    const { provider, calls } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "Texto del artículo 1.")), 200, true),
    });
    const section = await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.equal(section?.providerId, "boe");
    assert.equal(section?.lawCode, ID);
    assert.equal(section?.section, "1");
    assert.equal(section?.sourceUrl, metadata.data[0].url_html_consolidada);
    assert.equal(section?.isOfficialSource, true);
    assert.equal(section?.isAuthoritativeText, false);
    assert.match(section?.text ?? "", /Texto del artículo 1/);
    assert.doesNotMatch(section?.text ?? "", /Texto editorial/);
    assert.ok(calls.some((url) => url.endsWith("/texto/bloque/a1")));
  });

  it("selects the latest applicable block version and fails closed when it is ambiguous", async () => {
    const routes = {
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
    };
    const selected = providerWith({
      ...routes,
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a103`]: response(
        block("a103", `${version("2020-01-01", "Texto antiguo")}${version("2024-08-02", "Texto vigente")}`), 200, true,
      ),
    });
    const section = await selected.provider.getSection({ lawCode: ID, section: "103", referenceType: "article", jurisdiction: "ES" });
    assert.match(section?.text ?? "", /Texto vigente/);
    assert.doesNotMatch(section?.text ?? "", /Texto antiguo/);

    const ambiguous = providerWith({
      ...routes,
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(
        block("a1", `${version("2024-08-02", "A")}${version("2024-08-02", "B")}`), 200, true,
      ),
    });
    await assert.rejects(
      ambiguous.provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });

  it("rejects malformed index envelopes instead of returning null or stale cache", async () => {
    for (const malformedIndex of [
      { data: [{}] },
      { data: {} },
      { data: [{ bloque: [{}] }] },
      { data: [{ bloque: [{ id: "a1" }, { titulo: "Artículo 1" }] }] },
    ]) {
      const { provider, calls } = providerWith({
        [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
        [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
        [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(malformedIndex),
      });
      const cache = new InMemoryLawSectionCache();
      await cache.set({
        providerId: "boe",
        providerLabel: "BOE",
        lawCode: ID,
        lawTitle: metadata.data[0].titulo,
        section: "1",
        jurisdiction: "ES",
        text: "stale malformed-index fallback",
        retrievedAt: "2026-09-09T00:00:00.000Z",
        cacheStatus: "live",
        isOfficialSource: true,
        isAuthoritativeText: false,
      });
      const cachedProvider = new CachedLawProvider(provider, cache, {
        allowedProviderIds: ["boe"],
        now: () => new Date("2026-09-09T00:00:01.000Z"),
      });

      await assert.rejects(
        cachedProvider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
        LawProviderUnavailableError,
      );
      assert.equal(calls.some((url) => url.includes("/texto/bloque/")), false);
    }
  });

  it("rejects duplicate or whitespace-only block IDs before selection and cache fallback", async () => {
    for (const [malformedIndex, blockId, classificationRequired] of [
      [{ data: [{ bloque: [{ id: "a1", titulo: "Artículo 1" }, { id: "a1", titulo: "Artículo 2" }] }] }, "a1", false],
      [{ data: [{ bloque: [{ id: "   ", titulo: "Artículo 1" }] }] }, "   ", false],
      [{ data: [{ bloque: [{ id: "a1", titulo: "   " }] }] }, "a1", true],
    ] as const) {
      const { provider, calls } = providerWith({
        [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
        [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
        [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(malformedIndex),
        [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/${encodeURIComponent(blockId)}`]: response(
          block(blockId, version("2024-08-02", "integrity failure must not resolve")), 200, true,
        ),
      });
      const cache = new InMemoryLawSectionCache();
      await cache.set({
        providerId: "boe",
        providerLabel: "BOE",
        lawCode: ID,
        lawTitle: metadata.data[0].titulo,
        section: "1",
        jurisdiction: "ES",
        text: "stale integrity fallback",
        retrievedAt: "2026-09-09T00:00:00.000Z",
        cacheStatus: "live",
        isOfficialSource: true,
        isAuthoritativeText: false,
      });
      const cachedProvider = new CachedLawProvider(provider, cache, {
        allowedProviderIds: ["boe"],
        now: () => new Date("2026-09-09T00:00:01.000Z"),
      });

      await assert.rejects(
        cachedProvider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
        LawProviderUnavailableError,
      );
      assert.equal(calls.some((url) => url.includes("/texto/bloque/")), classificationRequired);
    }
  });

  it("preserves valid distinct IDs and definitive empty or nonmatching index absence", async () => {
    const distinct = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response({
        data: [{ bloque: [{ id: "a1", titulo: "Artículo 1" }, { id: "a2", titulo: "Artículo 2" }] }],
      }),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(
        block("a1", version("2024-08-02", "distinct valid ID text")), 200, true,
      ),
    });
    const distinctSection = await distinct.provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });
    assert.equal(distinctSection?.text, "distinct valid ID text");

    for (const indexValue of [
      { data: [{ bloque: [{ id: "a2", titulo: "Artículo 2" }] }] },
      { data: [{ bloque: [] }] },
    ]) {
      const { provider, calls } = providerWith({
        [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
        [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
        [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(indexValue),
      });
      assert.equal(
        await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
        null,
      );
      assert.equal(calls.some((url) => url.includes("/texto/bloque/")), false);
    }
  });

  it("returns null for invalid identity, unknown act, and unknown article", async () => {
    const mismatch = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response({ data: [{ ...metadata.data[0], identificador: "BOE-A-2015-00001" }] }),
    });
    assert.equal(await mismatch.provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), null);

    const unknown = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response({}, 404),
    });
    assert.equal(await unknown.provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), null);

    const noArticle = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
    });
    assert.equal(await noArticle.provider.getSection({ lawCode: ID, section: "999", referenceType: "article", jurisdiction: "ES" }), null);
    assert.equal(noArticle.calls.some((url) => url.includes("/texto/bloque/")), false);
  });

  it("rejects malformed IDs locally and maps 5xx to provider-unavailable", async () => {
    let calls = 0;
    const provider = new BoeLawProvider("https://api.example/legislacion-consolidada", async () => {
      calls += 1;
      return response({}, 503);
    });
    assert.equal(await provider.getSection({ lawCode: "BOE-A-2015-123456", section: "1", jurisdiction: "ES" }), null);
    assert.equal(calls, 0);
    await assert.rejects(
      provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }),
      LawProviderUnavailableError,
    );
  });
});
