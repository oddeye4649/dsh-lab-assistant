import { deflateRawSync, inflateRawSync } from 'node:zlib'

let crcTable = null

function table() {
  if (crcTable) return crcTable
  crcTable = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let value = i
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    crcTable[i] = value >>> 0
  }
  return crcTable
}

export function crc32(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  const lookup = table()
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) {
    crc = lookup[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value) {
  const buffer = Buffer.alloc(2)
  buffer.writeUInt16LE(value & 0xffff, 0)
  return buffer
}

function u32(value) {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value >>> 0, 0)
  return buffer
}

export function zipWrite(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const compressed = deflateRawSync(raw, { level: 9 })
    const crc = crc32(raw)
    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0),
      u32(crc), u32(compressed.length), u32(raw.length), u16(name.length), u16(0),
      name, compressed,
    ])
    locals.push(local)
    centrals.push(Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0),
      u32(crc), u32(compressed.length), u32(raw.length), u16(name.length),
      u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]))
    offset += local.length
  }
  const centralDir = Buffer.concat(centrals)
  const end = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralDir.length), u32(offset), u16(0),
  ])
  return Buffer.concat([...locals, centralDir, end])
}

export function zipRead(buffer) {
  const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  let eocd = -1
  for (let i = data.length - 22; i >= Math.max(0, data.length - 66000); i -= 1) {
    if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip/docx 文件')
  const count = data.readUInt16LE(eocd + 10)
  const cdOffset = data.readUInt32LE(eocd + 16)
  const files = new Map()
  let pointer = cdOffset
  for (let index = 0; index < count; index += 1) {
    if (data.readUInt32LE(pointer) !== 0x02014b50) throw new Error('zip 目录结构损坏')
    const method = data.readUInt16LE(pointer + 10)
    const compressedSize = data.readUInt32LE(pointer + 20)
    const nameLength = data.readUInt16LE(pointer + 28)
    const extraLength = data.readUInt16LE(pointer + 30)
    const commentLength = data.readUInt16LE(pointer + 32)
    const localOffset = data.readUInt32LE(pointer + 42)
    const name = data.slice(pointer + 46, pointer + 46 + nameLength).toString('utf8')
    if (data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('zip 文件头损坏')
    const localNameLength = data.readUInt16LE(localOffset + 26)
    const localExtraLength = data.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    const payload = data.slice(start, start + compressedSize)
    files.set(name, method === 0 ? payload : inflateRawSync(payload))
    pointer += 46 + nameLength + extraLength + commentLength
  }
  return files
}
