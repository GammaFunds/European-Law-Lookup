interface LexDaniaXmlNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly LexDaniaXmlChild[];
}

type LexDaniaXmlChild = LexDaniaXmlNode | string;

export interface LexDaniaDocumentMetadata {
  readonly documentType: string | null;
  readonly accessionNumber: string | null;
  readonly documentId: string | null;
  readonly uniqueDocumentId: string | null;
  readonly documentTitle: string | null;
  readonly popularTitle: string | null;
  readonly year: string | null;
  readonly number: string | null;
  readonly diesSigni: string | null;
  readonly status: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly ministry: string | null;
  readonly announcedIn: string | null;
}

export interface LexDaniaChangeEvidence {
  readonly accessionNumber: string | null;
  readonly effectiveDate: string | null;
  readonly text: string | null;
}

export interface LexDaniaParagraph {
  readonly localId: string;
  readonly section: string;
  readonly text: string;
  readonly subsections: readonly string[];
}

export interface LexDaniaDocument {
  readonly metadata: LexDaniaDocumentMetadata;
  readonly changes: readonly LexDaniaChangeEvidence[];
  readonly paragraphs: readonly LexDaniaParagraph[];
}

const METADATA_FIELDS: Readonly<Record<string, keyof LexDaniaDocumentMetadata>> = {
  DocumentType: "documentType",
  AccessionNumber: "accessionNumber",
  DocumentId: "documentId",
  UniqueDocumentId: "uniqueDocumentId",
  DocumentTitle: "documentTitle",
  PopularTitle: "popularTitle",
  Year: "year",
  Number: "number",
  DiesSigni: "diesSigni",
  Status: "status",
  StartDate: "startDate",
  EndDate: "endDate",
  Ministry: "ministry",
  AnnouncedIn: "announcedIn",
};

function localName(name: string): string {
  const separator = name.lastIndexOf(":");
  return separator < 0 ? name : name.slice(separator + 1);
}

function decodeXml(value: string): string | null {
  let invalidEntity = false;
  const decoded = value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,
    (entity, value: string) => {
      if (value === "amp") return "&";
      if (value === "lt") return "<";
      if (value === "gt") return ">";
      if (value === "quot") return '"';
      if (value === "apos") return "'";
      const codePoint = value.toLowerCase().startsWith("#x")
        ? Number.parseInt(value.slice(2), 16)
        : Number.parseInt(value.slice(1), 10);
      if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        invalidEntity = true;
        return "";
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        invalidEntity = true;
        return "";
      }
    },
  );
  if (/&/.test(decoded)) invalidEntity = true;
  return invalidEntity ? null : decoded;
}

function findTagEnd(xml: string, start: number): number {
  let quote = "";
  for (let index = start; index < xml.length; index += 1) {
    const character = xml[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return -1;
}

interface ParsedAttributes {
  readonly attributes: Readonly<Record<string, string>>;
  readonly namespaceDeclarations: Readonly<Record<string, string>>;
  readonly qualifiedAttributeNames: readonly string[];
}

function parseAttributes(source: string): ParsedAttributes | null {
  const attributes: Record<string, string> = {};
  const namespaceDeclarations: Record<string, string> = {};
  const qualifiedAttributeNames: string[] = [];
  let index = 0;
  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (index === source.length) break;
    const nameMatch = /^[^\s=/>]+/.exec(source.slice(index));
    if (!nameMatch) return null;
    const rawName = nameMatch[0];
    index += rawName.length;
    while (/\s/.test(source[index] ?? "")) index += 1;
    if (source[index] !== "=") return null;
    index += 1;
    while (/\s/.test(source[index] ?? "")) index += 1;
    const quote = source[index];
    if (quote !== '"' && quote !== "'") return null;
    index += 1;
    const valueStart = index;
    while (index < source.length && source[index] !== quote) index += 1;
    if (index === source.length) return null;
    const value = decodeXml(source.slice(valueStart, index));
    if (value === null) return null;
    if (rawName === "xmlns" || rawName.startsWith("xmlns:")) {
      const prefix = rawName === "xmlns" ? "" : rawName.slice("xmlns:".length);
      if (!prefix || Object.prototype.hasOwnProperty.call(namespaceDeclarations, prefix)) return null;
      namespaceDeclarations[prefix] = value;
    } else {
      if (Object.prototype.hasOwnProperty.call(attributes, localName(rawName))) return null;
      attributes[localName(rawName)] = value;
      if (rawName.includes(":")) qualifiedAttributeNames.push(rawName);
    }
    index += 1;
  }
  return { attributes, namespaceDeclarations, qualifiedAttributeNames };
}

function parseXml(xml: string): LexDaniaXmlNode | null {
  const roots: LexDaniaXmlNode[] = [];
  const stack: Array<{ name: string; attributes: Readonly<Record<string, string>>; children: LexDaniaXmlChild[]; namespaces: Readonly<Record<string, string>> }> = [];
  let cursor = 0;

  while (cursor < xml.length) {
    const open = xml.indexOf("<", cursor);
    if (open < 0) {
      const text = decodeXml(xml.slice(cursor));
      if (text === null) return null;
      if (stack.length > 0) stack[stack.length - 1].children.push(text);
      else if (text.trim() !== "") return null;
      break;
    }
    const text = decodeXml(xml.slice(cursor, open));
    if (text === null) return null;
    if (stack.length > 0) stack[stack.length - 1].children.push(text);
    else if (text.trim() !== "") return null;

    if (xml.startsWith("<!--", open)) {
      const end = xml.indexOf("-->", open + 4);
      if (end < 0) return null;
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      const end = xml.indexOf("]]>", open + 9);
      if (end < 0 || stack.length === 0) return null;
      stack[stack.length - 1].children.push(xml.slice(open + 9, end));
      cursor = end + 3;
      continue;
    }
    if (xml.startsWith("<?", open)) {
      const end = findTagEnd(xml, open + 2);
      if (end < 0) return null;
      cursor = end + 1;
      continue;
    }
    if (xml.startsWith("<!", open)) return null;

    const end = findTagEnd(xml, open + 1);
    if (end < 0) return null;
    const body = xml.slice(open + 1, end).trim();
    if (body.startsWith("/")) {
      const closeName = body.slice(1).trim();
      const closePrefix = closeName.includes(":") ? closeName.slice(0, closeName.indexOf(":")) : "";
      if (!/^[^\s/>]+$/.test(closeName) || stack.length === 0 || (closePrefix && !stack[stack.length - 1].namespaces[closePrefix]) || stack[stack.length - 1].name !== localName(closeName)) return null;
      const completed = stack.pop();
      if (!completed) return null;
      const node: LexDaniaXmlNode = { name: completed.name, attributes: completed.attributes, children: completed.children };
      if (stack.length > 0) stack[stack.length - 1].children.push(node);
      else roots.push(node);
    } else {
      const selfClosing = /\/\s*$/.test(body);
      const startBody = selfClosing ? body.replace(/\/\s*$/, "").trim() : body;
      const nameMatch = /^[^\s/>]+/.exec(startBody);
      if (!nameMatch) return null;
      const name = localName(nameMatch[0]);
      const parsedAttributes = parseAttributes(startBody.slice(nameMatch[0].length));
      if (!parsedAttributes) return null;
      const namespaces = { ...(stack[stack.length - 1]?.namespaces ?? {}), ...parsedAttributes.namespaceDeclarations };
      const prefix = nameMatch[0].includes(":") ? nameMatch[0].slice(0, nameMatch[0].indexOf(":")) : "";
      if (prefix && !namespaces[prefix]) return null;
      if (parsedAttributes.qualifiedAttributeNames.some((attributeName) => !namespaces[attributeName.slice(0, attributeName.indexOf(":"))])) return null;
      const entry = { name, attributes: parsedAttributes.attributes, children: [] as LexDaniaXmlChild[], namespaces };
      if (selfClosing) {
        const node: LexDaniaXmlNode = { name, attributes: entry.attributes, children: entry.children };
        if (stack.length > 0) stack[stack.length - 1].children.push(node);
        else roots.push(node);
      } else {
        stack.push(entry);
      }
    }
    cursor = end + 1;
  }
  if (stack.length !== 0 || roots.length !== 1) return null;
  return roots[0];
}

function directChildren(node: LexDaniaXmlNode, name: string): LexDaniaXmlNode[] {
  return node.children.filter((child): child is LexDaniaXmlNode => typeof child !== "string" && child.name === name);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function nodeText(node: LexDaniaXmlNode): string {
  return normalizeText(node.children.map((child) => typeof child === "string" ? child : nodeText(child)).join(" "));
}

function uniqueDirectText(parent: LexDaniaXmlNode, name: string): string | null {
  const matches = directChildren(parent, name);
  if (matches.length > 1) return null;
  return matches.length === 0 ? null : nodeText(matches[0]) || null;
}

function normalizedSection(localId: string): string | null {
  const match = /^§\s*(\d+)(?:\s+([a-z]))?$/.exec(normalizeText(localId));
  return match ? `${match[1]}${match[2] ? ` ${match[2]}` : ""}` : null;
}

function normalizedRequestedSection(section: string): string | null {
  const match = /^(\d+)(?:\s+([a-z]))?$/.exec(normalizeText(section));
  return match ? `${match[1]}${match[2] ? ` ${match[2]}` : ""}` : null;
}

function subsectionNumber(subsection: string): number | null {
  const match = /^(?:stk\.\s*)?(\d+)$/.exec(normalizeText(subsection));
  return match ? Number.parseInt(match[1], 10) : null;
}

function descendantNodes(node: LexDaniaXmlNode, name: string): LexDaniaXmlNode[] {
  const found: LexDaniaXmlNode[] = [];
  for (const child of node.children) {
    if (typeof child !== "string") {
      if (child.name === name) found.push(child);
      found.push(...descendantNodes(child, name));
    }
  }
  return found;
}

export function parseLexDaniaXml(xml: string): LexDaniaDocument | null {
  const root = parseXml(xml);
  if (!root || root.name !== "Dokument") return null;
  const metas = directChildren(root, "Meta");
  const contents = directChildren(root, "DokumentIndhold");
  if (metas.length !== 1 || contents.length !== 1) return null;
  const meta = metas[0];
  const metadata: Record<keyof LexDaniaDocumentMetadata, string | null> = {
    documentType: null,
    accessionNumber: null,
    documentId: null,
    uniqueDocumentId: null,
    documentTitle: null,
    popularTitle: null,
    year: null,
    number: null,
    diesSigni: null,
    status: null,
    startDate: null,
    endDate: null,
    ministry: null,
    announcedIn: null,
  };
  for (const [sourceName, field] of Object.entries(METADATA_FIELDS)) {
    const value = uniqueDirectText(meta, sourceName);
    if (directChildren(meta, sourceName).length > 1) return null;
    metadata[field] = value;
  }

  const changes: LexDaniaChangeEvidence[] = [];
  for (const change of directChildren(meta, "Change")) {
    if (["Ref_Accn", "Ref_Af", "Ref_Text"].some((name) => directChildren(change, name).length > 1)) return null;
    changes.push({
      accessionNumber: uniqueDirectText(change, "Ref_Accn"),
      effectiveDate: uniqueDirectText(change, "Ref_Af"),
      text: uniqueDirectText(change, "Ref_Text"),
    });
  }

  const paragraphs: LexDaniaParagraph[] = [];
  const seenSections = new Set<string>();
  const directParagraphs = directChildren(contents[0], "Paragraf");
  if (descendantNodes(contents[0], "Paragraf").length !== directParagraphs.length) return null;
  for (const paragraph of directParagraphs) {
    const localId = paragraph.attributes.localId;
    if (!localId) return null;
    const section = normalizedSection(localId);
    if (!section || seenSections.has(section)) return null;
    seenSections.add(section);
    const subsections = directChildren(paragraph, "Stk").map(nodeText);
    paragraphs.push({ localId, section, text: nodeText(paragraph), subsections });
  }
  return { metadata, changes, paragraphs };
}

export function findLexDaniaReference(
  document: LexDaniaDocument,
  section: string,
  subsection?: string,
): { text: string } | null {
  const normalized = normalizedRequestedSection(section);
  if (!normalized) return null;
  const paragraph = document.paragraphs.find((candidate) => candidate.section === normalized);
  if (!paragraph) return null;
  if (subsection === undefined) return { text: paragraph.text };
  const number = subsectionNumber(subsection);
  if (number === null || number < 1 || number > paragraph.subsections.length) return null;
  return { text: paragraph.subsections[number - 1] };
}
