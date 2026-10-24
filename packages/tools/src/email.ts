/**
 * Outbound email over SMTP.
 *
 * Implemented on `node:net`/`node:tls` rather than an SMTP library: the project
 * forbids new dependencies, and the subset needed here — AUTH LOGIN over
 * implicit TLS or STARTTLS, one message per connection — is small enough to own.
 *
 * Sending is an irreversible outward-facing action, so the tool is marked
 * `requiresApproval` and refuses to send unless the caller explicitly asks for
 * it after approval.
 */
import { createConnection, type Socket } from 'node:net'
import { connect as connectTls, type TLSSocket } from 'node:tls'
import { toolError, truncate, type ToolResult } from '@marketing-agent/shared'
import { defineTool, optionalStringArg, requireStringArg } from './registry.ts'
import type { IntegrationStore, SmtpConfig } from './integrations.ts'

const DEFAULT_SMTP_TIMEOUT_MS = 20_000

interface SmtpResponse {
  readonly code: number
  readonly lines: string[]
}

/**
 * A minimal SMTP conversation. Responses are multi-line (`250-...`) until a line
 * begins with the code followed by a space (`250 ...`).
 */
class SmtpSession {
  private buffer = ''
  private pending: ((response: SmtpResponse) => void) | undefined
  private rejection: ((error: Error) => void) | undefined
  private readonly queue: SmtpResponse[] = []

  constructor(private readonly socket: Socket | TLSSocket) {
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.onData(chunk))
    socket.on('error', (error: Error) => this.fail(error))
    socket.on('close', () => this.fail(new Error('Kết nối SMTP bị đóng')))
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\r\n')
    this.buffer = lines.pop() ?? ''
    const collected: string[] = []
    for (const line of lines) {
      collected.push(line)
      const match = /^(\d{3})([ -])/.exec(line)
      if (match && match[2] === ' ') {
        const response: SmtpResponse = { code: Number(match[1]), lines: [...collected] }
        collected.length = 0
        if (this.pending) {
          const resolve = this.pending
          this.pending = undefined
          this.rejection = undefined
          resolve(response)
        } else {
          this.queue.push(response)
        }
      }
    }
  }

  private fail(error: Error): void {
    if (this.rejection) {
      const reject = this.rejection
      this.pending = undefined
      this.rejection = undefined
      reject(error)
    }
  }

  /** Wait for the next server response. */
  read(): Promise<SmtpResponse> {
    const queued = this.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise<SmtpResponse>((resolve, reject) => {
      this.pending = resolve
      this.rejection = reject
    })
  }

  async command(text: string, expectedCodes: readonly number[]): Promise<SmtpResponse> {
    this.socket.write(`${text}\r\n`)
    const response = await this.read()
    if (!expectedCodes.includes(response.code)) {
      throw toolError(`SMTP lỗi ở lệnh "${text.split(' ')[0]}": ${truncate(response.lines.join(' '), 300)}`)
    }
    return response
  }

  writeRaw(data: string): void {
    this.socket.write(data)
  }

  end(): void {
    this.socket.end()
  }
}

export interface SendMailInput {
  readonly config: SmtpConfig
  readonly to: readonly string[]
  readonly subject: string
  readonly body: string
  readonly replyTo?: string
  readonly timeoutMs?: number
}

/** Result of a successful send: every recipient was accepted by the server. */
export interface SendMailResult {
  readonly accepted: readonly string[]
  readonly messageId: string
}

/** Send one plain-text email. Throws a tool error describing the SMTP failure. */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const { config } = input
  if (!config.host || !config.port) throw toolError('Cấu hình SMTP thiếu host hoặc port')
  if (input.to.length === 0) throw toolError('Cần ít nhất một người nhận')
  const port = config.port
  const useImplicitTls = port === 465
  const timeoutMs = input.timeoutMs ?? DEFAULT_SMTP_TIMEOUT_MS

  const socket: Socket | TLSSocket = useImplicitTls
    ? connectTls({ host: config.host, port, servername: config.host, timeout: timeoutMs })
    : createConnection({ host: config.host, port, timeout: timeoutMs })

  await new Promise<void>((resolveReady, rejectReady) => {
    const onReady = () => resolveReady()
    socket.once(useImplicitTls ? 'secureConnect' : 'connect', onReady)
    socket.once('error', rejectReady)
    socket.setTimeout(timeoutMs, () => rejectReady(new Error('SMTP hết thời gian chờ')))
  })

  const session = new SmtpSession(socket)
  try {
    await session.read() // greeting
    const ehlo = await session.command(`EHLO marketing-agent`, [250])
    const capabilities = ehlo.lines.join(' ')

    // Upgrade to TLS when the server advertises STARTTLS and we are not already on TLS.
    if (!useImplicitTls && /STARTTLS/i.test(capabilities)) {
      await session.command('STARTTLS', [220])
      const secured = await upgradeToTls(socket, config.host)
      session.end()
      const tlsSession = new SmtpSession(secured)
      await tlsSession.command(`EHLO marketing-agent`, [250])
      await authenticateAndSend(tlsSession, input)
      return { accepted: input.to, messageId: buildMessageId() }
    }

    await authenticateAndSend(session, input)
    return { accepted: input.to, messageId: buildMessageId() }
  } finally {
    try {
      socket.end()
    } catch {
      // Already closed; nothing to do.
    }
  }
}

/** Open SMTP, negotiate TLS when advertised, and authenticate without sending a message. */
export async function verifySmtpConnection(config: SmtpConfig, timeoutMs = DEFAULT_SMTP_TIMEOUT_MS): Promise<void> {
  if (!config.host || !config.port) throw toolError('Cấu hình SMTP thiếu host hoặc port')
  const implicitTls = config.port === 465
  const socket: Socket | TLSSocket = implicitTls
    ? connectTls({ host: config.host, port: config.port, servername: config.host, timeout: timeoutMs })
    : createConnection({ host: config.host, port: config.port, timeout: timeoutMs })
  await new Promise<void>((resolve, reject) => {
    socket.once(implicitTls ? 'secureConnect' : 'connect', resolve)
    socket.once('error', reject)
    socket.setTimeout(timeoutMs, () => reject(new Error('SMTP hết thời gian chờ')))
  })
  let activeSocket: Socket | TLSSocket = socket
  let session = new SmtpSession(socket)
  try {
    const greeting = await session.read()
    if (greeting.code !== 220) throw toolError(`SMTP từ chối kết nối: ${truncate(greeting.lines.join(' '), 300)}`)
    let ehlo = await session.command('EHLO marketing-agent', [250])
    if (!implicitTls && /STARTTLS/i.test(ehlo.lines.join(' '))) {
      await session.command('STARTTLS', [220])
      const secured = await upgradeToTls(socket, config.host)
      activeSocket = secured
      session = new SmtpSession(secured)
      ehlo = await session.command('EHLO marketing-agent', [250])
    }
    if (config.user) {
      await session.command('AUTH LOGIN', [334])
      await session.command(Buffer.from(config.user, 'utf8').toString('base64'), [334])
      await session.command(Buffer.from(config.password, 'utf8').toString('base64'), [235])
    }
    await session.command('QUIT', [221, 250])
  } finally {
    try { activeSocket.end() } catch { /* already closed */ }
  }
}

async function authenticateAndSend(session: SmtpSession, input: SendMailInput): Promise<void> {
  const { config } = input
  if (config.user) {
    // AUTH LOGIN: base64 username, then base64 password.
    const challenge = await session.command('AUTH LOGIN', [334])
    if (challenge.code === 334) {
      await session.command(Buffer.from(config.user, 'utf8').toString('base64'), [334])
      await session.command(Buffer.from(config.password, 'utf8').toString('base64'), [235])
    }
  }
  await session.command(`MAIL FROM:<${extractAddress(config.from)}>`, [250])
  for (const recipient of input.to) {
    await session.command(`RCPT TO:<${extractAddress(recipient)}>`, [250, 251])
  }
  await session.command('DATA', [354])
  session.writeRaw(buildMimeMessage(input))
  await session.command('.', [250])
  await session.command('QUIT', [221])
  session.end()
}

/** Wrap the current socket in TLS after STARTTLS. */
function upgradeToTls(socket: Socket | TLSSocket, host: string): Promise<TLSSocket> {
  return new Promise<TLSSocket>((resolveUpgrade, rejectUpgrade) => {
    const secured = connectTls({ socket: socket as Socket, servername: host }, () => resolveUpgrade(secured))
    secured.once('error', rejectUpgrade)
  })
}

export function buildMessageId(): string {
  const random = Math.random().toString(36).slice(2, 12)
  return `<${Date.now()}.${random}@marketing-agent>`
}

/** Pull the bare address out of `Name <addr@host>` or `addr@host`. */
export function extractAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value)
  return (match?.[1] ?? value).trim()
}

/** Build an RFC 5322 message with UTF-8 headers and a base64-encoded body. */
export function buildMimeMessage(input: {
  config: SmtpConfig
  to: readonly string[]
  subject: string
  body: string
  replyTo?: string
}): string {
  const headers = [
    `From: ${input.config.from}`,
    `To: ${input.to.join(', ')}`,
    ...(input.replyTo ? [`Reply-To: ${input.replyTo}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(input.subject, 'utf8').toString('base64')}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${buildMessageId()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ]
  // Wrap at 76 characters as the base64 transfer encoding requires.
  const encoded = Buffer.from(input.body, 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n')
  return `${headers.join('\r\n')}\r\n\r\n${encoded}\r\n`
}

export function createEmailTools(store: IntegrationStore) {
  const emailSend = defineTool({
    name: 'email_send',
    description:
      'Gửi email cho danh sách người nhận qua SMTP đã cấu hình. Đây là hành động không thể thu hồi — MẶC ĐỊNH chỉ soạn bản nháp, cần người dùng phê duyệt trước khi gửi thật.',
    parameters: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Danh sách email người nhận' },
        subject: { type: 'string', description: 'Tiêu đề email' },
        body: { type: 'string', description: 'Nội dung email dạng văn bản' },
        replyTo: { type: 'string', description: 'Địa chỉ trả lời (tuỳ chọn)' },
        send: { type: 'boolean', description: 'true = gửi thật (cần phê duyệt); mặc định false = chỉ soạn nháp' },
      },
      required: ['to', 'subject', 'body'],
      additionalProperties: false,
    },
    roles: ['email-crm', 'marketing-leader'],
    requiresApproval: true,
    async handler(args, ctx): Promise<ToolResult> {
      const recipients = Array.isArray(args['to'])
        ? args['to'].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        : []
      if (recipients.length === 0) throw toolError('Cần ít nhất một người nhận trong "to"')
      const subject = requireStringArg(args, 'subject')
      const body = requireStringArg(args, 'body')
      const replyTo = optionalStringArg(args, 'replyTo')
      const send = args['send'] === true || ctx.automation !== undefined

      if (!send) {
        return {
          content:
            `BẢN NHÁP email (chưa gửi).\n\nNgười nhận: ${recipients.join(', ')}\n` +
            `Tiêu đề: ${subject}\n\n${truncate(body, 4_000)}\n\n` +
            'Để gửi thật, người dùng cần phê duyệt và gọi lại với send = true.',
          data: { status: 'draft', to: recipients, subject, requiresApproval: true },
        }
      }

      const config = store.require(ctx.companyId, 'email-smtp', 'SMTP gửi email')
      const result = await sendMail({
        config,
        to: recipients,
        subject,
        body,
        replyTo,
      })
      store.markChecked(ctx.companyId, 'email-smtp', 'ok')
      return {
        content: `Đã gửi email "${subject}" tới ${result.accepted.length} người nhận.`,
        data: { status: 'sent', to: recipients, subject, messageId: result.messageId },
      }
    },
  })

  return { emailSend }
}
