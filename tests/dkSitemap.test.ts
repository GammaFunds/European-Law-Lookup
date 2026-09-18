import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import type { LawProviderHttpResponse, LawProviderHttpTransport } from "../src/law/httpTransport";
import {
  RETSINFORMATION_ELI_SITEMAP_URL,
  enumerateRetsinformationSitemap,
} from "../src/law/providers/RetsinformationSitemap";

const PAGE_ONE = "https://www.retsinformation.dk/eli/sitemap-1.xml";
const PAGE_TWO = "https://www.retsinformation.dk/eli/sitemap-2.xml";
const FOREIGN_PAGE = "https://foreign.example.test/eli/sitemap-foreign.xml";
const SITEMAP_NAMESPACE = "http://www.sitemaps.org/schemas/sitemap/0.9";

function response(text: string, status = 200): LawProviderHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => null,
  };
}

function transportFor(
  pages: Record<string, LawProviderHttpResponse | Error>,
): { fetchFn: LawProviderHttpTransport; calls: string[] } {
  const calls: string[] = [];
  const fetchFn: LawProviderHttpTransport = async (url) => {
    calls.push(url);
    const page = pages[url];
    if (!page) throw new Error(`unexpected URL: ${url}`);
    if (page instanceof Error) throw page;
    return page;
  };
  return { fetchFn, calls };
}

const INDEX = `<?xml version="1.0"?><sitemapindex xmlns="${SITEMAP_NAMESPACE}">
  <sitemap><loc>${PAGE_ONE}</loc></sitemap>
  <sitemap><loc>${PAGE_TWO}</loc></sitemap>
</sitemapindex>`;

describe("Retsinformation sitemap enumeration", () => {
  it("fetches the official index and pages sequentially, preserving exact lastmod and sorting", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(INDEX),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}">
        <url><loc>https://www.retsinformation.dk/eli/lta/2024/20</loc><lastmod>2024-02-03T04:05:06+01:00</lastmod></url>
        <url><loc>https://www.retsinformation.dk/eli/lta/2024/2</loc></url>
      </urlset>`),
      [PAGE_TWO]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}">
        <url><loc>https://www.retsinformation.dk/eli/lta/2023/9</loc><lastmod>2023-12-31</lastmod></url>
        <url><loc>https://www.retsinformation.dk/eli/lta/2024/20</loc><lastmod>2024-02-03T04:05:06+01:00</lastmod></url>
      </urlset>`),
    });

    const entries = await enumerateRetsinformationSitemap(scripted.fetchFn, {
      sleep: async () => undefined,
    });

    assert.deepEqual(scripted.calls, [RETSINFORMATION_ELI_SITEMAP_URL, PAGE_ONE, PAGE_TWO]);
    assert.deepEqual(entries, [
      { canonicalEli: "/eli/lta/2023/9", sitemapLastModified: "2023-12-31" },
      { canonicalEli: "/eli/lta/2024/2", sitemapLastModified: null },
      { canonicalEli: "/eli/lta/2024/20", sitemapLastModified: "2024-02-03T04:05:06+01:00" },
    ]);
  });

  it("rejects foreign hosts, noncanonical paths, and malformed ELI locations", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(INDEX),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}">
        <url><loc>https://www.retsinformation.dk/eli/lta/2024/1/</loc></url>
        <url><loc>https://retsinformation.dk/eli/lta/2024/2</loc></url>
        <url><loc>https://example.test/eli/lta/2024/3</loc></url>
        <url><loc>/eli/lta/2024/4</loc></url>
        <url><loc>https://www.retsinformation.dk/lta/2024/5</loc></url>
      </urlset>`),
      [PAGE_TWO]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}">
        <url><loc>https://www.retsinformation.dk/eli/lta/2024/6</loc></url>
      </urlset>`),
    });

    assert.deepEqual(
      await enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      [{ canonicalEli: "/eli/lta/2024/6", sitemapLastModified: null }],
    );
  });

  it("rejects a foreign sitemap-page reference before fetching it", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`<?xml version="1.0"?><sitemapindex xmlns="${SITEMAP_NAMESPACE}">
        <sitemap><loc>${FOREIGN_PAGE}</loc></sitemap>
      </sitemapindex>`),
      [FOREIGN_PAGE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://www.retsinformation.dk/eli/lta/2024/12</loc></url></urlset>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /official|sitemap page|origin|host/i,
    );
    assert.deepEqual(scripted.calls, [RETSINFORMATION_ELI_SITEMAP_URL]);
  });

  it("rejects a wrong sitemap-index root instead of searching arbitrary fragments", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`<not-an-index xmlns="${SITEMAP_NAMESPACE}">
        <sitemap><loc>${PAGE_ONE}</loc></sitemap>
      </not-an-index>`),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://www.retsinformation.dk/eli/lta/2024/1</loc></url></urlset>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /root|index|malformed/i,
    );
    assert.deepEqual(scripted.calls, [RETSINFORMATION_ELI_SITEMAP_URL]);
  });

  it("rejects a wrong sitemap-page root instead of searching arbitrary fragments", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`<?xml version="1.0"?><sitemapindex xmlns="${SITEMAP_NAMESPACE}">
        <sitemap><loc>${PAGE_ONE}</loc></sitemap>
      </sitemapindex>`),
      [PAGE_ONE]: response(`<garbage xmlns="${SITEMAP_NAMESPACE}">
        <url><loc>https://www.retsinformation.dk/eli/lta/2024/1</loc></url>
      </garbage>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /root|urlset|malformed/i,
    );
  });

  it("rejects structurally malformed sitemap XML", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`<?xml version="1.0"?><sitemapindex xmlns="${SITEMAP_NAMESPACE}">
        <sitemap><loc>${PAGE_ONE}</loc></sitemap>
      </sitemapindex>`),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://www.retsinformation.dk/eli/lta/2024/1</loc></urlset>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /malformed|XML|url/i,
    );
  });

  it("rejects an unterminated sitemap index at EOF", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`<sitemapindex xmlns="${SITEMAP_NAMESPACE}">
        <sitemap><loc>${PAGE_ONE}</loc>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /malformed|unterminated|EOF|closing/i,
    );
    assert.deepEqual(scripted.calls, [RETSINFORMATION_ELI_SITEMAP_URL]);
  });

  it("rejects an unterminated sitemap page at EOF", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`<?xml version="1.0"?><sitemapindex xmlns="${SITEMAP_NAMESPACE}">
        <sitemap><loc>${PAGE_ONE}</loc></sitemap>
      </sitemapindex>`),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}">
        <url><loc>https://www.retsinformation.dk/eli/lta/2014/433</loc>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /malformed|unterminated|EOF|closing/i,
    );
    assert.deepEqual(scripted.calls, [RETSINFORMATION_ELI_SITEMAP_URL, PAGE_ONE]);
  });

  it("rejects sitemap records and locations that are only descendants", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(INDEX),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}">
        <wrapper><url><loc>https://www.retsinformation.dk/eli/lta/2024/13</loc></url></wrapper>
      </urlset>`),
      [PAGE_TWO]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://www.retsinformation.dk/eli/lta/2024/17</loc></url></urlset>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /malformed|direct|sitemap|URL/i,
    );
    assert.deepEqual(scripted.calls, [RETSINFORMATION_ELI_SITEMAP_URL, PAGE_ONE]);
  });

  it("rejects sitemap records and locations nested below direct children", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`<?xml version="1.0"?><sitemapindex xmlns="${SITEMAP_NAMESPACE}">
        <sitemap><wrapper><loc>${PAGE_ONE}</loc></wrapper></sitemap>
      </sitemapindex>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /malformed|direct|loc|URL/i,
    );
    assert.deepEqual(scripted.calls, [RETSINFORMATION_ELI_SITEMAP_URL]);
  });

  it("rejects a location nested below a direct URL record", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`<?xml version="1.0"?><sitemapindex xmlns="${SITEMAP_NAMESPACE}">
        <sitemap><loc>${PAGE_ONE}</loc></sitemap>
      </sitemapindex>`),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}">
        <url><wrapper><loc>https://www.retsinformation.dk/eli/lta/2024/14</loc></wrapper></url>
      </urlset>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /malformed|direct|loc|URL/i,
    );
    assert.deepEqual(scripted.calls, [RETSINFORMATION_ELI_SITEMAP_URL, PAGE_ONE]);
  });

  it("rejects duplicate namespace declarations", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`<sitemapindex xmlns="${SITEMAP_NAMESPACE}" xmlns="${SITEMAP_NAMESPACE}">
        <sitemap><loc>${PAGE_ONE}</loc></sitemap>
      </sitemapindex>`),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://www.retsinformation.dk/eli/lta/2024/15</loc></url></urlset>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /duplicate|namespace|malformed/i,
    );
    assert.deepEqual(scripted.calls, [RETSINFORMATION_ELI_SITEMAP_URL]);
  });

  it("rejects duplicate ordinary XML attributes", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`<?xml version="1.0"?><sitemapindex xmlns="${SITEMAP_NAMESPACE}">
        <sitemap><loc>${PAGE_ONE}</loc></sitemap>
      </sitemapindex>`),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}">
        <url foo="a" foo="b"><loc>https://www.retsinformation.dk/eli/lta/2024/16</loc></url>
      </urlset>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /duplicate|attribute|malformed/i,
    );
  });

  it("preserves valid identities and lastmod through formatting whitespace", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(`
        <?xml version="1.0"?>
        <sitemapindex xmlns="${SITEMAP_NAMESPACE}">
          <sitemap>
            <loc>
              ${PAGE_ONE}
            </loc>
          </sitemap>
        </sitemapindex>
      `),
      [PAGE_ONE]: response(`
        <urlset xmlns="${SITEMAP_NAMESPACE}">
          <url>
            <loc>
              https://www.retsinformation.dk/eli/lta/2024/7
            </loc>
            <lastmod>2024-07-08T09:10:11+02:00</lastmod>
          </url>
        </urlset>
      `),
    });

    assert.deepEqual(
      await enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      [{ canonicalEli: "/eli/lta/2024/7", sitemapLastModified: "2024-07-08T09:10:11+02:00" }],
    );
  });

  it("rejects conflicting duplicate canonical identities across pages", async () => {
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(INDEX),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://www.retsinformation.dk/eli/lta/2024/8</loc><lastmod>2024-01-01</lastmod></url></urlset>`),
      [PAGE_TWO]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://www.retsinformation.dk/eli/lta/2024/8</loc><lastmod>2024-01-02</lastmod></url></urlset>`),
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      /duplicate|conflict|lastmod/i,
    );
  });

  it("fetches sitemap pages sequentially using a causal barrier", async () => {
    let pageOneStarted!: () => void;
    const pageOneStartedPromise = new Promise<void>((resolve) => { pageOneStarted = resolve; });
    let releasePageOne!: () => void;
    const pageOneRelease = new Promise<void>((resolve) => { releasePageOne = resolve; });
    let pageTwoRequested = false;
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(INDEX),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://www.retsinformation.dk/eli/lta/2024/10</loc></url></urlset>`),
      [PAGE_TWO]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://www.retsinformation.dk/eli/lta/2024/11</loc></url></urlset>`),
    });
    const originalFetch = scripted.fetchFn;
    scripted.fetchFn = async (url, options) => {
      if (url === PAGE_ONE) {
        pageOneStarted();
        await pageOneRelease;
      }
      if (url === PAGE_TWO) pageTwoRequested = true;
      return originalFetch(url, options);
    };

    const enumeration = enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined });
    await pageOneStartedPromise;
    assert.equal(pageTwoRequested, false);
    releasePageOne();
    await enumeration;
    assert.equal(pageTwoRequested, true);
  });

  it("propagates a referenced page failure instead of returning a partial set", async () => {
    const pageFailure = new Error("page unavailable");
    const scripted = transportFor({
      [RETSINFORMATION_ELI_SITEMAP_URL]: response(INDEX),
      [PAGE_ONE]: response(`<urlset xmlns="${SITEMAP_NAMESPACE}"><url><loc>https://www.retsinformation.dk/eli/lta/2024/1</loc></url></urlset>`),
      [PAGE_TWO]: pageFailure,
    });

    await assert.rejects(
      enumerateRetsinformationSitemap(scripted.fetchFn, { sleep: async () => undefined }),
      pageFailure,
    );
    assert.deepEqual(scripted.calls, [
      RETSINFORMATION_ELI_SITEMAP_URL,
      PAGE_ONE,
      PAGE_TWO,
      PAGE_TWO,
      PAGE_TWO,
      PAGE_TWO,
    ]);
  });
});
