import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

describe("law metadata autocomplete", () => {
  it("exports the jurisdiction-aware metadata search function", () => {
    const searchModule = require("../src/law/lawMetadataSearch") as Record<string, unknown>;
    assert.equal(
      typeof searchModule.searchLawMetadata,
      "function",
      "expected searchLawMetadata() to be exported",
    );
  });
});
