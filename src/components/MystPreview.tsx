import katex from 'katex'
import 'katex/dist/katex.min.css'
import morphdom from 'morphdom'
import {
  memo,
  startTransition,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { renderMyst } from '../lib/myst'

interface MystPreviewProps {
  assetBaseUrl?: string
  content: string
}

const previewDelayMs = 400

export const MystPreview = memo(({ assetBaseUrl, content }: MystPreviewProps) => {
  const previewRef = useRef<HTMLElement>(null)
  const deferredContent = useDeferredValue(content)
  const [previewContent, setPreviewContent] = useState(deferredContent)
  const preview = useMemo(
    () => renderMyst(previewContent, { assetBaseUrl }),
    [assetBaseUrl, previewContent],
  )

  useEffect(() => {
    if (deferredContent === previewContent) return
    const timeout = window.setTimeout(() => {
      startTransition(() => setPreviewContent(deferredContent))
    }, previewDelayMs)
    return () => window.clearTimeout(timeout)
  }, [deferredContent, previewContent])

  useLayoutEffect(() => {
    const previewElement = previewRef.current
    if (!previewElement) return

    const nextPreview = previewElement.cloneNode(false) as HTMLElement
    nextPreview.innerHTML = preview.html
    morphdom(previewElement, nextPreview, { childrenOnly: true })

    previewElement
      .querySelectorAll<HTMLElement>('.math-display, .math-inline')
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
    />
  )
})
