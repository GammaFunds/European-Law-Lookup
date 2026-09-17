export interface DkCanonicalEli {
  canonicalEli: string;
  pubMedia: string;
  year: string;
  number: string;
}

const dkEliPattern = /^(?:https:\/\/www\.retsinformation\.dk\/eli\/|\/eli\/|)([a-z]+)\/(\d{4})\/(\d+)$/iu;

export function parseDkCanonicalEli(input: string): DkCanonicalEli | null {
  const match = dkEliPattern.exec(input.trim());
  if (!match) return null;

  const pubMedia = match[1].toLowerCase();
  const year = match[2];
  const number = match[3];
  return {
    canonicalEli: `/eli/${pubMedia}/${year}/${number}`,
    pubMedia,
    year,
    number,
  };
}
