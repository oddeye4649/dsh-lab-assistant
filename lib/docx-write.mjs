import { zipWrite } from './zip.mjs'

const EMU_PER_PIXEL = 9525
const MAX_WIDTH_EMU = 5.8 * 914400

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function imageSize(buffer, name = '') {
  if (buffer.length > 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), ext: 'png' }
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue }
      const marker = buffer[offset + 1]
      const length = buffer.readUInt16BE(offset + 2)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5), ext: 'jpeg' }
      }
      offset += 2 + length
    }
  }
  return { width: 800, height: 450, ext: /\.jpe?g$/i.test(name) ? 'jpeg' : 'png' }
}

function paragraph(text, style) {
  const props = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''
  return `<w:p>${props}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
}

function bullet(text) {
  return `<w:p><w:pPr><w:ind w:left="420" w:hanging="210"/></w:pPr><w:r><w:t xml:space="preserve">• ${escapeXml(text)}</w:t></w:r></w:p>`
}

function tableXml(headers, rows) {
  const border = 'w:val="single" w:sz="4" w:space="0" w:color="B7C4D6"'
  const cell = (text, bold) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>`
    + `<w:p><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}`
    + `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p></w:tc>`
  const head = headers.length
    ? `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((text) => cell(text, true)).join('')}</w:tr>`
    : ''
  const body = rows.map((row) => `<w:tr>${row.map((text) => cell(text, false)).join('')}</w:tr>`).join('')
  return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>'
    + `<w:tblBorders><w:top ${border}/><w:left ${border}/><w:bottom ${border}/><w:right ${border}/>`
    + `<w:insideH ${border}/><w:insideV ${border}/></w:tblBorders></w:tblPr>${head}${body}</w:tbl>`
}

function imageXml(image, relId, index) {
  const size = imageSize(image.data, image.name)
  const ratio = size.height / size.width
  const width = Math.min(size.width * EMU_PER_PIXEL, MAX_WIDTH_EMU)
  const height = Math.round(width * ratio)
  const docPrId = index + 1
  return '<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>'
    + `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${Math.round(width)}" cy="${height}"/>`
    + `<wp:docPr id="${docPrId}" name="Picture ${docPrId}"/><a:graphic>`
    + '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>'
    + `<pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${escapeXml(image.name)}"/><pic:cNvPicPr/></pic:nvPicPr>`
    + `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`
    + `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(width)}" cy="${height}"/></a:xfrm>`
    + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline>'
    + '</w:drawing></w:r></w:p>'
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="宋体" w:hAnsi="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="90"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/><w:basedOn w:val="Normal"/><w:pPr><w:jc w:val="center"/><w:spacing w:after="160"/></w:pPr><w:rPr><w:color w:val="5A6B85"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`

export function buildDocx(model) {
  const media = []
  const rels = []
  let relId = 2
  const bodyParts = []
  if (model.title) bodyParts.push(paragraph(model.title, 'Title'))
  if (model.subtitle) bodyParts.push(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(model.subtitle)}</w:t></w:r></w:p>`)
  if (model.meta?.length) {
    bodyParts.push(tableXml([], model.meta.map(([label, value]) => [label, value])))
    bodyParts.push('<w:p/>')
  }

  let imageIndex = 0
  for (const section of model.sections || []) {
    if (section.title) {
      const level = Math.min(3, Math.max(1, Number(section.level) || 1))
      bodyParts.push(paragraph(section.title, `Heading${level}`))
    }
    for (const text of section.paragraphs || []) bodyParts.push(paragraph(text))
    for (const text of section.bullets || []) bodyParts.push(bullet(text))
    if (section.table) bodyParts.push(tableXml(section.table.headers || [], section.table.rows || []))
    for (const image of section.images || []) {
      const size = imageSize(image.data, image.name)
      const id = `rId${relId}`
      relId += 1
      media.push({ name: `word/media/${image.name}`, data: image.data })
      rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.name}"/>`)
      bodyParts.push(imageXml({ ...image, ext: size.ext }, id, imageIndex))
      imageIndex += 1
      if (image.caption) bodyParts.push(paragraph(image.caption, 'Caption'))
    }
  }
  bodyParts.push('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr>')

  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    + ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"'
    + ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
    + ' xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
    + `<w:body>${bodyParts.join('')}</w:body></w:document>`

  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Default Extension="png" ContentType="image/png"/>'
    + '<Default Extension="jpeg" ContentType="image/jpeg"/>'
    + '<Default Extension="jpg" ContentType="image/jpeg"/>'
    + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    + '</Types>'

  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    + '</Relationships>'

  const documentRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + rels.join('') + '</Relationships>'

  return zipWrite([
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRels },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/styles.xml', data: STYLES },
    { name: 'word/_rels/document.xml.rels', data: documentRels },
    ...media,
  ])
}
