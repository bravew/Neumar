// Per-session tool registry. Tool availability is request-scoped (MCP
// servers connected, skills pinned, permission rules), so a global
// registry would need careful invalidation; per-session is GC'd with
// the session.
//
// NOTE: claude-agent-sdk v0.2 uses a frozen `tools: { type: 'preset' }`
// config with no hook for synthetic tools or lazy schemas. Adapters
// that ride that preset cannot wire tool-search through the SDK —
// only via POST /tools/search or adapters that build their own tool
// list (codex, openai-compat, http-agent).

import type { ToolDescriptor, ToolSearchInput } from './tool-search';
import { searchTools } from './tool-search';

export type ToolMaterializer = (name: string) => Promise<{
  inputSchema: unknown;
  handler: (args: unknown) => Promise<unknown>;
} | null>;

export interface RegisteredTool {
  descriptor: ToolDescriptor;
  materialize: ToolMaterializer;
}

export class AdapterToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(descriptor: ToolDescriptor, materialize: ToolMaterializer): void {
    this.tools.set(descriptor.name, { descriptor, materialize });
  }

  registerMany(entries: readonly RegisteredTool[]): void {
    for (const e of entries) this.register(e.descriptor, e.materialize);
  }

  descriptors(): ToolDescriptor[] {
    return Array.from(this.tools.values()).map((t) => t.descriptor);
  }

  search(input: ToolSearchInput): ReturnType<typeof searchTools> {
    return searchTools(this.descriptors(), input);
  }

  async materialize(
    name: string,
  ): Promise<Awaited<ReturnType<ToolMaterializer>>> {
    const entry = this.tools.get(name);
    if (!entry) return null;
    return entry.materialize(name);
  }

  size(): number {
    return this.tools.size;
  }
}
