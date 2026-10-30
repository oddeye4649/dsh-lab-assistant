import { zipRead } from './zip.mjs'

function decodeXml(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function textOf(xml) {
  const parts = []
  const regex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  let match
  while ((match = regex.exec(xml))) parts.push(decodeXml(match[1]))
  return parts.join('').replace(/\s+/g, ' ').trim()
}

function levelOfStyle(style, outline) {
  if (outline != null) return Math.min(6, Math.max(1, Number(outline) + 1))
  const value = String(style || '').trim()
  if (!value) return 0
  const named = /(?:heading|标题|標題)\s*(\d)/i.exec(value)
  if (named) return Math.min(6, Math.max(1, Number(named[1])))
  if (/^heading$/i.test(value)) return 1
  if (/^title$/i.test(value)) return 1
  if (/^\d$/.test(value)) return Number(value)
  return 0
}

export function parseDocumentXml(xml) {
  const blocks = []
  const token = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g
  let match
  while ((match = token.exec(xml))) {
    const chunk = match[0]
    if (chunk.startsWith('<w:tbl')) {
      const rows = []
      const rowRegex = /<w:tr\b[\s\S]*?<\/w:tr>/g
      let rowMatch
      while ((rowMatch = rowRegex.exec(chunk))) {
        const cells = []
        const cellRegex = /<w:tc\b[\s\S]*?<\/w:tc>/g
        let cellMatch
        while ((cellMatch = cellRegex.exec(rowMatch[0]))) cells.push(textOf(cellMatch[0]))
        if (cells.length) rows.push(cells)
      }
      if (rows.length) blocks.push({ type: 'table', rows })
      continue
    }
    const text = textOf(chunk)
    if (!text) continue
    const styleMatch = /<w:pStyle\s+w:val="([^"]+)"/.exec(chunk)
    const outlineMatch = /<w:outlineLvl\s+w:val="(\d+)"/.exec(chunk)
    const level = levelOfStyle(styleMatch?.[1], outlineMatch?.[1])
    if (level) blocks.push({ type: 'heading', level, text })
    else blocks.push({ type: 'paragraph', text })
  }
  return blocks
}

export function readDocx(buffer) {
  const files = zipRead(buffer)
  const documentXml = files.get('word/document.xml')
  if (!documentXml) throw new Error('docx 里找不到 word/document.xml')
  return {
    blocks: parseDocumentXml(documentXml.toString('utf8')),
    media: [...files.keys()].filter((name) => name.startsWith('word/media/')),
  }
}

export function readMarkdown(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let table = null
  const flushTable = () => {
    if (table && table.rows.length) blocks.push({ type: 'table', rows: table.rows })
    table = null
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (!line) { flushTable(); continue }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushTable()
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }
    if (/^\|.*\|$/.test(line)) {
      const cells = line.slice(1, -1).split('|').map((cell) => cell.trim())
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
      table = table || { rows: [] }
      table.rows.push(cells)
      continue
    }
    flushTable()
    blocks.push({ type: 'paragraph', text: line })
  }
  flushTable()
  return blocks
}
