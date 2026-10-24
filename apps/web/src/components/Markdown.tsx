/**
 * Hiển thị Markdown an toàn.
 *
 * Vì sao tự viết thay vì dùng `marked`/`react-markdown`: agent tạo ra Markdown có
 * kiểm soát (bảng, tiêu đề, danh sách, code), nên một bộ chuyển đổi nhỏ là đủ, và
 * quan trọng hơn — tự viết thì kiểm soát được việc escape HTML. Mọi nội dung do
 * model sinh ra đều bị escape TRƯỚC khi ghép thẻ, nên không có đường nào để HTML
 * từ nội dung agent chạy trong trình duyệt của người dùng.
 */
import type { ReactNode } from 'react'

/** Escape ký tự HTML; bắt buộc chạy trước mọi bước ghép thẻ. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Chuyển Markdown thành HTML đã escape.
 *
 * Xử lý theo khối trước (code fence, bảng, danh sách, trích dẫn) rồi mới tới nội
 * tuyến, vì nếu đảo thứ tự thì dấu `*` bên trong code block sẽ bị hiểu thành in đậm.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let inCode = false
  let codeBuffer: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let tableBuffer: string[] = []

  const dongDanhSach = (type: 'ul' | 'ol' | null): void => {
    if (listType) {
      html.push(`</${listType}>`)
      listType = null
    }
    void type
  }

  const ketThucBang = (): void => {
    if (tableBuffer.length === 0) return
    html.push(renderTable(tableBuffer))
    tableBuffer = []
  }

  for (const rawLine of lines) {
    const line = rawLine

    // Khối code: giữ nguyên nội dung, chỉ escape.
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
        codeBuffer = []
        inCode = false
      } else {
        dongDanhSach(null)
        ketThucBang()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuffer.push(line)
      continue
    }

    // Bảng: gom các dòng bắt đầu bằng `|` rồi xử lý một lần.
    if (line.trim().startsWith('|')) {
      dongDanhSach(null)
      tableBuffer.push(line.trim())
      continue
    }
    ketThucBang()

    if (line.trim().length === 0) {
      dongDanhSach(null)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      dongDanhSach(null)
      const level = Math.min(6, heading[1]?.length ?? 1)
      html.push(`<h${level}>${inline(heading[2] ?? '')}</h${level}>`)
      continue
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(line)) {
      dongDanhSach(null)
      html.push('<hr />')
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      dongDanhSach(null)
      html.push(`<blockquote>${inline(quote[1] ?? '')}</blockquote>`)
      continue
    }

    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (unordered) {
      if (listType !== 'ul') {
        dongDanhSach(null)
        html.push('<ul>')
        listType = 'ul'
      }
      html.push(`<li>${inline(unordered[1] ?? '')}</li>`)
      continue
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      if (listType !== 'ol') {
        dongDanhSach(null)
        html.push('<ol>')
        listType = 'ol'
      }
      html.push(`<li>${inline(ordered[1] ?? '')}</li>`)
      continue
    }

    dongDanhSach(null)
    html.push(`<p>${inline(line)}</p>`)
  }

  if (inCode) html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`)
  ketThucBang()
  dongDanhSach(null)
  return html.join('\n')
}

/** Bảng Markdown: dòng đầu là tiêu đề, dòng thứ hai là phân cách. */
function renderTable(rows: readonly string[]): string {
  const cells = rows.map((row) =>
    row
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim()),
  )
  const [header, ...body] = cells
  if (!header) return ''
  const isSeparator = (row: readonly string[] | undefined): boolean =>
    row !== undefined && row.every((cell) => /^:?-{2,}:?$/.test(cell))
  const dataRows = isSeparator(body[0]) ? body.slice(1) : body

  const head = `<tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr>`
  const bodyHtml = dataRows
    .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
    .join('')
  return `<table><thead>${head}</thead><tbody>${bodyHtml}</tbody></table>`
}

/**
 * Định dạng nội tuyến. Escape trước, rồi mới thay thế bằng thẻ — thứ tự này là
 * điều kiện để HTML trong nội dung không bao giờ được thi hành.
 */
function inline(text: string): string {
  let out = escapeHtml(text)
  // Render only same-origin knowledge images or HTTPS images. The URL is still
  // escaped above, and restricting the source prevents agent-authored markup
  // from loading arbitrary protocols.
  out = out.replace(/!\[([^\]]*)\]\(((?:https:\/\/|\/api\/)[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy" />')
  // Code nội tuyến trước, để `*` bên trong code không thành in đậm.
  out = out.replace(/`([^`]+)`/g, (_match, code: string) => `<code>${code}</code>`)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  // Liên kết: chỉ chấp nhận http/https, chặn javascript: và data:.
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  out = out.replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
  return out
}

/** Bọc markdown đã chuyển thành thành phần React. */
export function Markdown({ children }: { children: string }): ReactNode {
  return <div className="md" dangerouslySetInnerHTML={{ __html: markdownToHtml(children) }} />
}
