import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createObsidianRequestUrlTransport } from "../src/law/httpTransport";

describe("requestUrl response headers", () => {
  it("preserves Retry-After", async () => {
    const transport = createObsidianRequestUrlTransport(async () => ({
      status: 429,
      text: "",
      json: null,
      headers: { "retry-after": "3" },
    }));

    const response = await transport("https://example.invalid");

    assert.equal(response.headers?.["retry-after"], "3");
  });
});
