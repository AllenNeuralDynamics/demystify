import { Grammar } from '@citation-js/core/lib-mjs/util/grammar.js'
import { Translator } from '@citation-js/core/lib-mjs/util/translator.js'

export const util = { Grammar, Translator }

export const logger = {
  warn: (...messages: unknown[]) => console.warn(...messages),
}