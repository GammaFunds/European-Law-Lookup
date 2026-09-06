import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

describe("law metadata autocomplete", () => {
  it("has a dedicated metadata-only search layer", () => {
    let resolved: string | null = null;
    try {
      resolved = require.resolve("../src/law/lawMetadataSearch");
    } catch {
      resolved = null;
    }

    assert.ok(resolved, "expected src/law/lawMetadataSearch.ts to exist");
  });
});
