import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  enumerateRetsinformationSitemap,
} from "../src/law/providers/RetsinformationSitemap";
import type { LawProviderHttpResponse, LawProviderHttpTransport } from "../src/law/httpTransport";

const OFFICIAL_INDEX_URL = "https://www.retsinformation.dk/eli/sitemap.xml";
const OFFICIAL_ORIGIN = "https://www.retsinformation.dk";

function response(body: string, status = 200): LawProviderHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => null,
  };
}

function makeSitemapIndex(pageUrls: string[]): string {
  const sitemaps = pageUrls.map((url) => `<sitemap><loc>${url}</loc></sitemap>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemaps}
</sitemapindex>`;
}

function makeSitemapPage(
  entries: Array<{ loc: string; lastmod?: string }>
): string {
  const urls = entries
    .map((e) => {
      const lastmod = e.lastmod !== undefined ? `<lastmod>${e.lastmod}</lastmod>` : "";
      return `<url><loc>${e.loc}</loc>${lastmod}</url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

function scriptedTransport(
  responses: Map<string, string | Error>,
): {
  fetchFn: LawProviderHttpTransport;
  calls: string[];
  delays: number[];
} {
  const calls: string[] = [];
  const delays: number[] = [];
  const fetchFn: LawProviderHttpTransport = async (url) => {
    calls.push(url);
    const key = url.split("?")[0];
    const outcome = responses.get(key);
    if (outcome === undefined) {
      throw new Error(`unexpected URL: ${url}`);
    }
    if (outcome instanceof Error) throw outcome;
    return response(outcome);
  };
  return { fetchFn, calls, delays };
}

describe("enumerateRetsinformationSitemap", () => {
  async function assertIndexRejected(xml: string): Promise<void> {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const page2Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-2.xml`;
    const validPage = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433` },
    ]);
    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, xml],
      [page1Url, validPage],
      [page2Url, validPage],
    ]);
    const { fetchFn } = scriptedTransport(responses);
    await assert.rejects(enumerateRetsinformationSitemap(fetchFn));
  }

  async function assertPageRejected(xml: string): Promise<void> {
    const pageUrl = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([pageUrl])],
      [pageUrl, xml],
    ]);
    const { fetchFn } = scriptedTransport(responses);
    await assert.rejects(enumerateRetsinformationSitemap(fetchFn));
  }

  it("rejects a sitemap record nested below an unrelated wrapper", async () => {
    await assertIndexRejected(`<?xml version="1.0"?>
<sitemapindex xmlns="${"http://www.sitemaps.org/schemas/sitemap/0.9"}"><wrapper><sitemap><loc>${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml</loc></sitemap></wrapper></sitemapindex>`);
  });

  it("rejects a url record nested below an unrelated wrapper", async () => {
    await assertPageRejected(`<?xml version="1.0"?>
<urlset xmlns="${"http://www.sitemaps.org/schemas/sitemap/0.9"}"><wrapper><url><loc>${OFFICIAL_ORIGIN}/eli/lta/2014/433</loc></url></wrapper></urlset>`);
  });

  it("rejects multiple XML document roots", async () => {
    await assertIndexRejected(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml</loc></sitemap></sitemapindex><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${OFFICIAL_ORIGIN}/eli/sitemap-page-2.xml</loc></sitemap></sitemapindex>`);
  });

  it("rejects an unterminated sitemap index after one complete record", async () => {
    await assertIndexRejected(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml</loc></sitemap>`);
  });

  it("rejects an unterminated sitemap page after one complete record", async () => {
    await assertPageRejected(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${OFFICIAL_ORIGIN}/eli/lta/2014/433</loc></url>`);
  });

  it("rejects mismatched closing tags", async () => {
    await assertIndexRejected(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml</loc></url></sitemapindex>`);
  });

  it("rejects the wrong sitemap namespace", async () => {
    await assertIndexRejected(`<sitemapindex xmlns="urn:wrong"><sitemap><loc>${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml</loc></sitemap></sitemapindex>`);
  });

  it("rejects duplicate namespace declarations", async () => {
    await assertIndexRejected(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml</loc></sitemap></sitemapindex>`);
  });

  it("rejects duplicate ordinary XML attributes", async () => {
    await assertIndexRejected(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" data-x="a" data-x="b"><sitemap><loc>${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml</loc></sitemap></sitemapindex>`);
  });

  for (const [label, malformedName] of [
    ["ordinary attribute", "foo:bar:baz=\"x\""],
    ["namespace declaration", "xmlns:foo:bar=\"urn:test\""],
  ]) {
    it(`rejects a malformed QName in an ${label}`, async () => {
      const pageUrl = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
      const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ${malformedName}><sitemap><loc>${pageUrl}</loc></sitemap></sitemapindex>`;
      const { fetchFn, calls } = scriptedTransport(new Map([[OFFICIAL_INDEX_URL, xml]]));

      await assert.rejects(
        enumerateRetsinformationSitemap(fetchFn, { sleep: async () => {} }),
        (error: Error) => {
          assert.equal(error.message, "malformed XML sitemap document");
          return true;
        },
      );
      assert.deepEqual(calls, [OFFICIAL_INDEX_URL]);
    });
  }

  it("rejects a malformed multi-colon element QName", async () => {
    const pageUrl = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap:foo:bar><loc>${pageUrl}</loc></sitemap:foo:bar></sitemapindex>`;
    const { fetchFn, calls } = scriptedTransport(new Map([[OFFICIAL_INDEX_URL, xml]]));

    await assert.rejects(
      enumerateRetsinformationSitemap(fetchFn, { sleep: async () => {} }),
      (error: Error) => {
        assert.equal(error.message, "malformed XML sitemap document");
        return true;
      },
    );
    assert.deepEqual(calls, [OFFICIAL_INDEX_URL]);
  });

  for (const [label, pageUrl] of [
    ["username", "https://user@www.retsinformation.dk/eli/sitemap-1.xml"],
    ["password/userinfo", "https://user:secret@www.retsinformation.dk/eli/sitemap-1.xml"],
    ["HTTP", "http://www.retsinformation.dk/eli/sitemap-1.xml"],
    ["explicit default port", "https://www.retsinformation.dk:443/eli/sitemap-1.xml"],
    ["explicit non-default port", "https://www.retsinformation.dk:444/eli/sitemap-1.xml"],
  ]) {
    it(`rejects page URL with ${label} before fetch`, async () => {
      const responses = new Map<string, string | Error>([[OFFICIAL_INDEX_URL, makeSitemapIndex([pageUrl])]]);
      const { fetchFn, calls } = scriptedTransport(responses);
      await assert.rejects(
        enumerateRetsinformationSitemap(fetchFn, { sleep: async () => {} }),
        (error: Error) => {
          assert.match(error.message, /^rejected foreign sitemap page origin:/);
          return true;
        },
      );
      assert.deepEqual(calls, [OFFICIAL_INDEX_URL]);
    });
  }

  it("fetches official index URL and parses referenced pages sequentially", async () => {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const page2Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-2.xml`;

    const page1 = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-02-03T04:05:06+01:00" },
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2020/100`, lastmod: "2021-06-15T12:00:00Z" },
    ]);
    const page2 = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2019/200`, lastmod: "2023-01-10T08:30:00+01:00" },
    ]);

    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([page1Url, page2Url])],
      [page1Url, page1],
      [page2Url, page2],
    ]);
    const { fetchFn, calls, delays } = scriptedTransport(responses);

    const entries = await enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } });

    assert.equal(calls[0], OFFICIAL_INDEX_URL);
    assert.equal(calls.length, 3);
    assert.equal(entries.length, 3);
    assert.deepEqual(entries, [
      { canonicalEli: "/eli/lta/2014/433", sitemapLastModified: "2024-02-03T04:05:06+01:00" },
      { canonicalEli: "/eli/lta/2019/200", sitemapLastModified: "2023-01-10T08:30:00+01:00" },
      { canonicalEli: "/eli/lta/2020/100", sitemapLastModified: "2021-06-15T12:00:00Z" },
    ]);
  });

  it("preserves lastmod exactly and returns null when absent", async () => {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const page1 = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-02-03T04:05:06+01:00" },
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2020/100` },
    ]);

    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([page1Url])],
      [page1Url, page1],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    const entries = await enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } });

    assert.equal(entries.length, 2);
    assert.equal(entries[0].sitemapLastModified, "2024-02-03T04:05:06+01:00");
    assert.equal(entries[1].sitemapLastModified, null);
  });

  it("excludes foreign host resources", async () => {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const page1 = makeSitemapPage([
      { loc: "https://example.com/eli/lta/2014/433", lastmod: "2024-01-01T00:00:00Z" },
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-02-03T04:05:06+01:00" },
    ]);

    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([page1Url])],
      [page1Url, page1],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    const entries = await enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].canonicalEli, "/eli/lta/2014/433");
  });

  it("excludes noncanonical ELI locations", async () => {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const page1 = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433/extra`, lastmod: "2024-01-01T00:00:00Z" },
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-02-03T04:05:06+01:00" },
    ]);

    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([page1Url])],
      [page1Url, page1],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    const entries = await enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].canonicalEli, "/eli/lta/2014/433");
  });

  it("rejects foreign sitemap page URL", async () => {
    const foreignPageUrl = "https://example.com/eli/sitemap-page-1.xml";
    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([foreignPageUrl])],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    await assert.rejects(
      enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } }),
      (error: Error) => {
        assert.ok(error.message.includes("foreign") || error.message.includes("origin") || error.message.includes("invalid") || error.message.includes("unauthorized"));
        return true;
      },
    );
  });

  it("fails closed on malformed sitemap index", async () => {
    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, "this is not valid xml"],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    await assert.rejects(
      enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } }),
      (error: Error) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
  });

  it("fails closed on malformed sitemap page", async () => {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([page1Url])],
      [page1Url, "this is not valid xml"],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    await assert.rejects(
      enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } }),
      (error: Error) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
  });

  it("propagates page fetch failure without returning partial results", async () => {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const page2Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-2.xml`;
    const page1 = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-02-03T04:05:06+01:00" },
    ]);

    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([page1Url, page2Url])],
      [page1Url, page1],
      [page2Url, new Error("network failure")],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    await assert.rejects(
      enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } }),
      (error: Error) => {
        assert.equal(error.message, "network failure");
        return true;
      },
    );
  });

  it("deduplicates identical entries without multiplying", async () => {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const page2Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-2.xml`;
    const page1 = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-02-03T04:05:06+01:00" },
    ]);
    const page2 = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-02-03T04:05:06+01:00" },
    ]);

    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([page1Url, page2Url])],
      [page1Url, page1],
      [page2Url, page2],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    const entries = await enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].canonicalEli, "/eli/lta/2014/433");
  });

  it("fails closed when duplicate entries have conflicting lastmod", async () => {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const page2Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-2.xml`;
    const page1 = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-02-03T04:05:06+01:00" },
    ]);
    const page2 = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-03-01T00:00:00Z" },
    ]);

    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([page1Url, page2Url])],
      [page1Url, page1],
      [page2Url, page2],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    await assert.rejects(
      enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } }),
      (error: Error) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
  });

  it("fetches pages sequentially (page 2 does not begin before page 1 completes)", async () => {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const page2Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-2.xml`;

    let page1Completed = false;
    const page1Body = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-02-03T04:05:06+01:00" },
    ]);
    const page2Body = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2019/200`, lastmod: "2023-01-10T08:30:00+01:00" },
    ]);

    const calls: string[] = [];
    const fetchFn: LawProviderHttpTransport = async (url) => {
      calls.push(url);
      if (url === page1Url) {
        const result = response(page1Body);
        page1Completed = true;
        return result;
      }
      if (url === page2Url) {
        assert.ok(page1Completed, "page 2 must not begin before page 1 completes");
        return response(page2Body);
      }
      if (url === OFFICIAL_INDEX_URL) {
        return response(makeSitemapIndex([page1Url, page2Url]));
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const entries = await enumerateRetsinformationSitemap(fetchFn);

    assert.equal(entries.length, 2);
    assert.equal(calls.indexOf(page1Url) < calls.indexOf(page2Url), true);
  });

  it("does not infer legal time or currentness from lastmod", async () => {
    const page1Url = `${OFFICIAL_ORIGIN}/eli/sitemap-page-1.xml`;
    const page1 = makeSitemapPage([
      { loc: `${OFFICIAL_ORIGIN}/eli/lta/2014/433`, lastmod: "2024-02-03T04:05:06+01:00" },
    ]);

    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, makeSitemapIndex([page1Url])],
      [page1Url, page1],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    const entries = await enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].sitemapLastModified, "2024-02-03T04:05:06+01:00");
  });

  it("fails on non-sitemap XML at index URL", async () => {
    const fakeXml = `<?xml version="1.0" encoding="UTF-8"?>
<root><item><loc>https://example.com</loc></item></root>`;
    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, fakeXml],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    await assert.rejects(
      enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } }),
      (error: Error) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
  });

  it("fails on sitemap index with no sitemap references", async () => {
    const emptyIndex = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</sitemapindex>`;
    const responses = new Map<string, string | Error>([
      [OFFICIAL_INDEX_URL, emptyIndex],
    ]);
    const { fetchFn, delays } = scriptedTransport(responses);

    await assert.rejects(
      enumerateRetsinformationSitemap(fetchFn, { sleep: async (ms) => { delays.push(ms); } }),
      (error: Error) => {
        assert.ok(error instanceof Error);
        return true;
      },
    );
  });
});
