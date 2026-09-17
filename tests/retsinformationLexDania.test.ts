import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  findLexDaniaReference,
  parseLexDaniaXml,
} from "../src/law/providers/retsinformationLexDania";

const lexDaniaXml = `<?xml version="1.0" encoding="UTF-8"?>
<lx:Dokument xmlns:lx="urn:retsinformation:lexdania">
  <lx:Meta>
    <lx:DocumentType>LBK</lx:DocumentType>
    <lx:AccessionNumber>ACC-2024-001</lx:AccessionNumber>
    <lx:DocumentId>DOC-433</lx:DocumentId>
    <lx:UniqueDocumentId>DK-UNIQUE-433</lx:UniqueDocumentId>
    <lx:DocumentTitle>Testlov</lx:DocumentTitle>
    <lx:PopularTitle>Den lille testlov</lx:PopularTitle>
    <lx:Year>2024</lx:Year>
    <lx:Number>433</lx:Number>
    <lx:DiesSigni>2024-06-12</lx:DiesSigni>
    <lx:Status>Gældende</lx:Status>
    <lx:StartDate>2024-07-01</lx:StartDate>
    <lx:EndDate>2025-06-30</lx:EndDate>
    <lx:Ministry>Justitsministeriet</lx:Ministry>
    <lx:AnnouncedIn>Lovtidende A</lx:AnnouncedIn>
    <lx:Change>
      <lx:Ref_Accn>ACC-CHANGE-7</lx:Ref_Accn>
      <lx:Ref_Af>2024-05-01</lx:Ref_Af>
      <lx:Ref_Text>Ændret ved lov nr. 7</lx:Ref_Text>
    </lx:Change>
  </lx:Meta>
  <lx:DokumentIndhold>
    <lx:Paragraf localId="§1">
      <lx:Rubrica>Formål</lx:Rubrica>
      <lx:Stk>
        <lx:Index>1</lx:Index>
        <lx:Indentatio>Første stykke.</lx:Indentatio>
      </lx:Stk>
      <lx:Stk>
        <lx:Rubrica>Andet stykke</lx:Rubrica>
        <lx:Indentatio>Andet stykke.</lx:Indentatio>
      </lx:Stk>
    </lx:Paragraf>
    <lx:Paragraf localId="§ 9 a">
      <lx:Stk><lx:Indentatio>Ni a.</lx:Indentatio></lx:Stk>
    </lx:Paragraf>
  </lx:DokumentIndhold>
</lx:Dokument>`;

describe("parseLexDaniaXml", () => {
  it("extracts source-backed metadata and Change evidence", () => {
    const document = parseLexDaniaXml(lexDaniaXml);

    assert.ok(document);
    assert.deepEqual(document.metadata, {
      documentType: "LBK",
      accessionNumber: "ACC-2024-001",
      documentId: "DOC-433",
      uniqueDocumentId: "DK-UNIQUE-433",
      documentTitle: "Testlov",
      popularTitle: "Den lille testlov",
      year: "2024",
      number: "433",
      diesSigni: "2024-06-12",
      status: "Gældende",
      startDate: "2024-07-01",
      endDate: "2025-06-30",
      ministry: "Justitsministeriet",
      announcedIn: "Lovtidende A",
    });
    assert.deepEqual(document.changes, [{
      accessionNumber: "ACC-CHANGE-7",
      effectiveDate: "2024-05-01",
      text: "Ændret ved lov nr. 7",
    }]);
  });

  it("returns combined paragraph text and exact direct Stk text", () => {
    const document = parseLexDaniaXml(lexDaniaXml);

    assert.ok(document);
    assert.deepEqual(findLexDaniaReference(document, "1"), {
      text: "Formål 1 Første stykke. Andet stykke Andet stykke.",
    });
    assert.deepEqual(findLexDaniaReference(document, "1", "stk. 2"), {
      text: "Andet stykke Andet stykke.",
    });
    assert.deepEqual(findLexDaniaReference(document, "1", "2"), {
      text: "Andet stykke Andet stykke.",
    });
  });

  it("resolves the explicit paragraph letter form", () => {
    const document = parseLexDaniaXml(lexDaniaXml);

    assert.ok(document);
    assert.deepEqual(findLexDaniaReference(document, "9 a"), { text: "Ni a." });
  });

  it("returns null for missing paragraphs and subsections", () => {
    const document = parseLexDaniaXml(lexDaniaXml);

    assert.ok(document);
    assert.equal(findLexDaniaReference(document, "2"), null);
    assert.equal(findLexDaniaReference(document, "1", "3"), null);
  });

  it("fails closed for malformed, HTML, and structurally non-LexDania input", () => {
    assert.equal(parseLexDaniaXml("<Dokument><Meta></Dokument>"), null);
    assert.equal(parseLexDaniaXml("<!doctype html><html><body>law</body></html>"), null);
    assert.equal(parseLexDaniaXml("<Root><Meta/><DokumentIndhold/></Root>"), null);
    assert.equal(parseLexDaniaXml("<Dokument><DokumentIndhold/></Dokument>"), null);
  });

  it("retains recursive Rubrica, Index, and Indentatio content without a dedicated text leaf", () => {
    const document = parseLexDaniaXml(lexDaniaXml);

    assert.ok(document);
    assert.match(findLexDaniaReference(document, "1")?.text ?? "", /Formål/);
    assert.match(findLexDaniaReference(document, "1")?.text ?? "", /1 Første stykke\./);
    assert.match(findLexDaniaReference(document, "1")?.text ?? "", /Andet stykke Andet stykke\./);
  });

  it("rejects an undeclared structural prefix", () => {
    assert.equal(parseLexDaniaXml(lexDaniaXml.replace(' xmlns:lx="urn:retsinformation:lexdania"', "")), null);
  });

  it("accepts the unprefixed namespace-tolerant form", () => {
    const unprefixed = lexDaniaXml.replace(/\blx:/g, "").replace(' xmlns="urn:retsinformation:lexdania"', "");
    const document = parseLexDaniaXml(unprefixed);

    assert.ok(document);
    assert.equal(document.metadata.announcedIn, "Lovtidende A");
  });

  it("rejects nested Paragraf nodes instead of creating overlapping records", () => {
    const nested = lexDaniaXml.replace(
      "    </lx:Paragraf>\n    <lx:Paragraf localId=\"§ 9 a\">",
      "      <lx:Paragraf localId=\"§2\"><lx:Stk><lx:Indentatio>Nested.</lx:Indentatio></lx:Stk></lx:Paragraf>\n    </lx:Paragraf>\n    <lx:Paragraf localId=\"§ 9 a\">",
    );

    assert.equal(parseLexDaniaXml(nested), null);
  });

  it("rejects duplicate Meta and DokumentIndhold envelopes", () => {
    assert.equal(parseLexDaniaXml(lexDaniaXml.replace("  <lx:Meta>", "  <lx:Meta/>\n  <lx:Meta>")), null);
    assert.equal(parseLexDaniaXml(lexDaniaXml.replace("  <lx:DokumentIndhold>", "  <lx:DokumentIndhold/>\n  <lx:DokumentIndhold>")), null);
  });

  it("rejects a Change with duplicate Ref_Accn children", () => {
    const duplicate = lexDaniaXml.replace(
      "      <lx:Ref_Accn>ACC-CHANGE-7</lx:Ref_Accn>",
      "      <lx:Ref_Accn>ACC-CHANGE-7</lx:Ref_Accn>\n      <lx:Ref_Accn>ACC-CHANGE-8</lx:Ref_Accn>",
    );
    assert.equal(parseLexDaniaXml(duplicate), null);
  });

  it("rejects a Change with duplicate Ref_Af children", () => {
    const duplicate = lexDaniaXml.replace(
      "      <lx:Ref_Af>2024-05-01</lx:Ref_Af>",
      "      <lx:Ref_Af>2024-05-01</lx:Ref_Af>\n      <lx:Ref_Af>2024-05-02</lx:Ref_Af>",
    );
    assert.equal(parseLexDaniaXml(duplicate), null);
  });

  it("rejects a Change with duplicate Ref_Text children", () => {
    const duplicate = lexDaniaXml.replace(
      "      <lx:Ref_Text>Ændret ved lov nr. 7</lx:Ref_Text>",
      "      <lx:Ref_Text>Ændret ved lov nr. 7</lx:Ref_Text>\n      <lx:Ref_Text>Ændret ved lov nr. 8</lx:Ref_Text>",
    );
    assert.equal(parseLexDaniaXml(duplicate), null);
  });
});
