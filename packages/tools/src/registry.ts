/**
 * The tool registry.
 *
 * Two rules make this safe to hand to a language model:
 *
 * 1. **Grant check happens here, not in the prompt.** A tool the agent's preset
 *    did not grant is reported as not-found, so a model cannot talk its way into
 *    a capability by naming it.
 * 2. **Every handler receives tenancy through `ToolContext`.** Tools never take a
 *    company id from their arguments, because those arguments come from the model.
 *
 * The registry is immutable after construction: tools are contributed at build
 * time, which keeps the surface a run can reach predictable.
 */
import {
  AppError,
  isAppError,
  toolError,
  type AgentRole,
  type ToolContext,
  type ToolDefinition,
  type ToolResult,
} from '@marketing-agent/shared'

export interface ToolDescriptor {
  readonly name: string
  readonly description: string
  readonly roles: readonly AgentRole[]
  readonly requiresApproval: boolean
}

export interface ToolCallRecord {
  readonly name: string
  readonly ok: boolean
  readonly durationMs: number
  readonly error?: string
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  constructor(tools: readonly ToolDefinition[] = []) {
    for (const tool of tools) this.register(tool)
  }

  private register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new AppError('internal', `Tool trùng tên: ${tool.name}`)
    }
    this.tools.set(tool.name, tool)
  }

  /** All known tools, for the settings screen and readiness reporting. */
  list(): ToolDescriptor[] {
    return [...this.tools.values()]
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        roles: tool.roles ?? [],
        requiresApproval: tool.requiresApproval ?? false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  /**
   * Tools visible to one agent: the intersection of what the deployment knows
   * and what the preset granted, further narrowed by the tool's own role list.
   * The intersection — never the union — is what keeps a grant from widening
   * access beyond a tool's intended audience.
   */
  grantedFor(agentRole: AgentRole, grantedNames: readonly string[]): ToolDefinition[] {
    const granted = new Set(grantedNames)
    return [...this.tools.values()].filter((tool) => {
      if (!granted.has(tool.name)) return false
      if (!tool.roles || tool.roles.length === 0) return true
      return tool.roles.includes(agentRole)
    })
  }

  /** Model-facing schemas for the granted subset. */
  toLlmDefinitions(tools: readonly ToolDefinition[]) {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
  }

  /**
   * Execute one tool call. Never throws: a failure becomes an `isError` result so
   * the model can read it and choose a different path, instead of the whole run
   * dying because one integration is down.
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
    grantedNames: readonly string[],
  ): Promise<ToolResult & { readonly durationMs: number }> {
    const started = Date.now()
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        content: `Công cụ "${name}" không tồn tại trong hệ thống này.`,
        isError: true,
        durationMs: Date.now() - started,
      }
    }
    if (!grantedNames.includes(name)) {
      // Deliberately vague about whether it exists: the agent has no business here.
      return {
        content: `Bạn không được cấp quyền dùng công cụ "${name}". Hãy báo cho Leader nếu bạn cần nó.`,
        isError: true,
        durationMs: Date.now() - started,
      }
    }
    if (tool.roles && tool.roles.length > 0 && !tool.roles.includes(ctx.agentRole)) {
      return {
        content: `Vai trò ${ctx.agentRole} không được phép dùng công cụ "${name}".`,
        isError: true,
        durationMs: Date.now() - started,
      }
    }

    try {
      const result = await tool.handler(args, ctx)
      return { ...result, durationMs: Date.now() - started }
    } catch (error) {
      const message = isAppError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error)
      ctx.log(`tool ${name} lỗi: ${message}`)
      return {
        content: `Công cụ "${name}" gặp lỗi: ${message}`,
        isError: true,
        data: isAppError(error) ? { code: error.code, details: error.details } : undefined,
        durationMs: Date.now() - started,
      }
    }
  }
}

/** Build a tool definition with the project's defaults applied. */
export function defineTool(input: {
  name: string
  description: string
  parameters: ToolDefinition['parameters']
  roles?: readonly AgentRole[]
  requiresApproval?: boolean
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>
}): ToolDefinition {
  return {
    name: input.name,
    description: input.description,
    parameters: input.parameters,
    roles: input.roles,
    requiresApproval: input.requiresApproval ?? false,
    handler: input.handler,
  }
}

/** Read a required string argument from model-supplied JSON. */
export function requireStringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw toolError(`Thiếu tham số bắt buộc "${key}"`)
  }
  return value.trim()
}

export function optionalStringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function optionalNumberArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

export function optionalStringArrayArg(args: Record<string, unknown>, key: string): string[] | undefined {
  const value = args[key]
  if (!Array.isArray(value)) return undefined
  const out = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
  return out.length > 0 ? out : undefined
}
