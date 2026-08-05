const htmlReplacements: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/g, (character) => htmlReplacements[character] ?? character)