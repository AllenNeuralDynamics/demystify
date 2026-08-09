declare module '@citation-js/plugin-bibtex/lib/input/file.js' {
  export const parse: (source: string) => unknown[]
}

declare module '@citation-js/plugin-bibtex/lib/input/entries.js' {
  export const parse: (entries: unknown[]) => unknown[]
}

declare module '@citation-js/plugin-bibtex/lib/output/entries.js' {
  export const formatBibtex: (entries: unknown[]) => unknown[]
}

declare module '@citation-js/plugin-bibtex/lib/output/bibtex.js' {
  export const format: (
    entries: unknown[],
    dictionary: Record<string, string[]>,
  ) => string
}

declare module '@citation-js/core/lib-mjs/util/grammar.js' {
  export class Grammar {
    constructor(rules: unknown, state?: unknown)
  }
}

declare module '@citation-js/core/lib-mjs/util/translator.js' {
  export class Translator {
    constructor(schema: unknown)
  }
}