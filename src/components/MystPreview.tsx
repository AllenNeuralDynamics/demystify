import katex from 'katex'
import 'katex/dist/katex.min.css'
import { useDeferredValue, useLayoutEffect, useRef } from 'react'
import { renderMyst } from '../lib/myst'

interface MystPreviewProps {
  content: string
}

export const MystPreview = ({ content }: MystPreviewProps) => {
  const previewRef = useRef<HTMLElement>(null)
  const deferredContent = useDeferredValue(content)
  const preview = renderMyst(deferredContent)

  useLayoutEffect(() => {
    previewRef.current
      ?.querySelectorAll<HTMLElement>('.math-display, .math-inline')
      .forEach((element) => {
        katex.render(element.textContent ?? '', element, {
          displayMode: element.classList.contains('math-display'),
          throwOnError: false,
          strict: 'ignore',
        })
      })
  }, [preview.html])

  if (preview.error) {
    return (
      <div className="preview-error" role="status">
        <strong>Preview paused</strong>
        <span>{preview.error}</span>
      </div>
    )
  }

  return (
    <article
      ref={previewRef}
      className="myst-preview"
      aria-label="Rendered MyST preview"
      dangerouslySetInnerHTML={{ __html: preview.html }}
    />
  )
}