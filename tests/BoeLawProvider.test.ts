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
const eli = `<rdf:RDF><eli:LegalExpression rdf:about="${ELI_WORK}/con/20240802/spa"><eli:id_local>${ID}</eli:id_local><eli:legal_expression_belongs_to_work rdf:resource="${ELI_WORK}"/><eli:version_date>2024-08-02</eli:version_date><eli:language rdf:resource="http://publications.europa.eu/resource/authority/language/SPA"/></eli:LegalExpression></rdf:RDF>`;
const index = {
  data: [{ bloque: [
    { id: "a1", titulo: "Artículo 1" },
    { id: "a103", titulo: "Artículo 103" },
    { id: "a172ter", titulo: "Art 172 ter" },
  ] }],
};
const block = (id: string, versions: string) => {
  const title = id === "a1" ? "1" : id === "a103" ? "103" : "172 ter";
  return `<bloque id="${id}" tipo="precepto" titulo="Artículo ${title}">${versions.replace(/Artículo 1/g, `Artículo ${title}`)}</bloque>`;
};
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
  const provider = new BoeLawProvider("https://api.example/legislacion-consolidada", async (url) => {
    calls.push(url);
    const route = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!route && url === RECORD_URL) return response(recordPage());
    if (!route) throw new Error(`unexpected request: ${url}`);
    return route[1];
  });
  return { provider, calls };
}

describe("BoeLawProvider", () => {
  it("accepts the current BOE work plus consolidated /con permalink shape", async () => {
    const { provider, calls } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(eli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "bound")), 200, true),
    });

    await provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" });

    assert.equal(calls[0], `https://api.example/legislacion-consolidada/id/${ID}/metadatos`);
    assert.equal(calls[1], RECORD_URL);
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
      .replace(`<eli:id_local>${ID}</eli:id_local>`, `<eli:id_local>${foreignId}</eli:id_local>`)
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
    const foreignEli = eli.replace(`<eli:id_local>${ID}</eli:id_local>`, "<eli:id_local>BOE-A-2015-10565</eli:id_local>");
    const { provider } = providerWith({
      [`https://api.example/legislacion-consolidada/id/${ID}/metadatos`]: response(metadata),
      [`https://api.example/legislacion-consolidada/id/${ID}/metadata-eli`]: response(foreignEli, 200, true),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "foreign local identity")), 200, true),
    });
    await assert.rejects(provider.getSection({ lawCode: ID, section: "1", referenceType: "article", jurisdiction: "ES" }), LawProviderUnavailableError);
  });

  it("rejects duplicate required ELI identity elements", async () => {
    const duplicate = eli.replace(`<eli:id_local>${ID}</eli:id_local>`, `<eli:id_local>${ID}</eli:id_local><eli:id_local>${ID}</eli:id_local>`);
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
        eli.replace(`<eli:legal_expression_belongs_to_work rdf:resource="${ELI_WORK}"/>`, ""), 200, true,
      ),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/indice`]: response(index),
      [`https://api.example/legislacion-consolidada/id/${ID}/texto/bloque/a1`]: response(block("a1", version("2024-08-02", "missing ELI identity text")), 200, true),
    });
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
