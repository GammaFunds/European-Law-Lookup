import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { parseDkCanonicalEli } from "../src/law/providers/retsinformationIdentity";
import { parseLawReferenceWithSelectedJurisdiction } from "../src/parser";

describe("DK identity/reference boundary", () => {
  it("normalizes bare identity but does not fabricate LawReference.section", () => {
    for (const input of [
      "https://www.retsinformation.dk/eli/lta/2014/433",
      "/eli/lta/2014/433",
      "lta/2014/433",
    ]) {
      assert.deepEqual(parseDkCanonicalEli(input), {
        canonicalEli: "/eli/lta/2014/433",
        pubMedia: "lta",
        year: "2014",
        number: "433",
      });
      assert.equal(parseLawReferenceWithSelectedJurisdiction(input, "DK"), null);
    }
  });

  it("accepts explicit paragraph, letter suffix and stk.", () => {
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("/eli/lta/2014/433 § 1, stk. 2", "DK"),
      {
        lawCode: "/eli/lta/2014/433",
        section: "1",
        subsection: "stk. 2",
        referenceType: "section",
        jurisdiction: "DK",
      },
    );
    assert.deepEqual(
      parseLawReferenceWithSelectedJurisdiction("lta/2014/433 § 9 a", "DK"),
      {
        lawCode: "/eli/lta/2014/433",
        section: "9 a",
        referenceType: "section",
        jurisdiction: "DK",
      },
    );
  });

  it("rejects ambiguous identity forms", () => {
    for (const input of [
      "2014/433",
      "LBK 433/2014",
      "Forvaltningsloven",
      "/lta/2014/433",
      "eli/lta/2014/433",
      "https://www.retsinformation.dk/lta/2014/433",
    ]) {
      assert.equal(parseDkCanonicalEli(input), null);
    }
  });
});
