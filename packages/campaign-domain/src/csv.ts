import { validation } from '@marketing-agent/shared'

export interface ImportedContact {
  readonly email: string
  readonly name: string | null
  readonly source: string
  readonly consentAt: string
  readonly consentVersion: string
}

/** Small RFC4180-compatible parser for the deliberately narrow contact import format. */
export function parseContactCsv(csv: string, defaults: { source: string; consentVersion: string; consentAt?: string }): ImportedContact[] {
  if (new TextEncoder().encode(csv).byteLength > 10 * 1024 * 1024) throw validation('Tệp CSV vượt quá 10 MiB')
  const rows = parseRows(csv)
  if (rows.length < 2) throw validation('CSV cần hàng tiêu đề và ít nhất một contact')
  const header = rows[0]!.map((value) => value.trim().toLowerCase())
  const emailIndex = header.indexOf('email')
  const nameIndex = header.indexOf('name') >= 0 ? header.indexOf('name') : header.indexOf('tên')
  const sourceIndex = header.indexOf('source')
  const consentAtIndex = header.indexOf('consent_at') >= 0 ? header.indexOf('consent_at') : header.indexOf('consentat')
  const consentVersionIndex = header.indexOf('consent_version') >= 0 ? header.indexOf('consent_version') : header.indexOf('consentversion')
  if (emailIndex < 0) throw validation('CSV bắt buộc có cột email')

  const fallbackAt = defaults.consentAt ?? new Date().toISOString()
  const contacts: ImportedContact[] = []
  const seen = new Set<string>()
  for (const row of rows.slice(1)) {
    const email = (row[emailIndex] ?? '').trim().toLowerCase()
    if (!email) continue
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validation(`Email không hợp lệ trong CSV: ${email}`)
    if (seen.has(email)) continue
    const consentAt = (consentAtIndex >= 0 ? row[consentAtIndex] : undefined)?.trim() || fallbackAt
    if (!Number.isFinite(Date.parse(consentAt))) throw validation(`consent_at không hợp lệ cho ${email}`)
    const source = ((sourceIndex >= 0 ? row[sourceIndex] : undefined)?.trim() || defaults.source).slice(0, 200)
    const consentVersion = ((consentVersionIndex >= 0 ? row[consentVersionIndex] : undefined)?.trim() || defaults.consentVersion).slice(0, 120)
    if (!source || !consentVersion) throw validation(`Thiếu nguồn hoặc phiên bản consent cho ${email}`)
    seen.add(email)
    contacts.push({
      email,
      name: ((nameIndex >= 0 ? row[nameIndex] : undefined)?.trim() || null),
      source,
      consentAt: new Date(consentAt).toISOString(),
      consentVersion,
    })
  }
  if (contacts.length === 0) throw validation('CSV không có contact hợp lệ')
  return contacts
}

function parseRows(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"'
        index += 1
      } else if (character === '"') {
        quoted = false
      } else {
        cell += character
      }
      continue
    }
    if (character === '"' && cell.length === 0) {
      quoted = true
    } else if (character === ',') {
      row.push(cell)
      cell = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      row.push(cell)
      if (row.some((value) => value.trim().length > 0)) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }
  if (quoted) throw validation('CSV có dấu ngoặc kép chưa đóng')
  if (cell.length > 0 || row.length > 0) {
    row.push(cell)
    if (row.some((value) => value.trim().length > 0)) rows.push(row)
  }
  return rows
}

