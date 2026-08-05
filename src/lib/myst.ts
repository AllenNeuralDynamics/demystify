import DOMPurify from 'dompurify'
import { mystParser } from 'myst-parser'
import { State, formatHtml, mystToHast, transform } from 'myst-to-html'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'

export interface MystRenderResult {
  html: string
  error: string | null
}

export const renderMyst = (source: string): MystRenderResult => {
  try {
    const pipeline = unified()
      .use(mystParser)
      .use(transform, new State())
      .use(mystToHast)
      .use(formatHtml)
      .use(rehypeStringify)
    const file = pipeline.processSync(source)

    return {
      html: DOMPurify.sanitize(String(file)),
      error: null,
    }
  } catch (error) {
    return {
      html: '',
      error: error instanceof Error ? error.message : 'The preview could not be rendered.',
    }
  }
}