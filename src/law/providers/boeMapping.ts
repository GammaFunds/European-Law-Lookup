export interface SupportedBoeLaw {
  displayLawCode: string;
  lawTitle: string;
  referenceType: "article";
  exampleInputs: readonly string[];
}

export function getSupportedBoeLaws(): readonly SupportedBoeLaw[] {
  return [
    { displayLawCode: "BOE-A-2015-10566", lawTitle: "Ley 40/2015", referenceType: "article", exampleInputs: ["BOE-A-2015-10566 Art. 1"] },
    { displayLawCode: "BOE-A-2015-10565", lawTitle: "Ley 39/2015", referenceType: "article", exampleInputs: ["BOE-A-2015-10565 Art. 1"] },
    { displayLawCode: "BOE-A-1889-4763", lawTitle: "Código Civil", referenceType: "article", exampleInputs: ["BOE-A-1889-4763 Art. 1"] },
  ];
}
