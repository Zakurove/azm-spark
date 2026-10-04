/**
 * The tool executor (product v7 contract 2.11 tool call timing, C-16, C-17, stream D, step D4). The
 * model's tool calls are requests; the app is authoritative.
 *
 *   - Each call is screened first (screenToolCall: unknown_tool, not_in_block, invalid_args, and the
 *     S0-2 answer guard's no_answer_heard), then handed to host.handleTool the moment it arrives; the
 *     results of one message go back at once, in one tool response, with the scheduling of the
 *     non blocking tools (TOOL_BEHAVIOR).
 *   - C-17: a call is applied once and is final. A toolCallCancellation for a call the host already
 *     applied changes nothing; the coach is told what the app did with a tool_applied P3 event. A
 *     cancellation for a call not handled yet drops it unapplied when it arrives. (S0 saw no
 *     cancellation at all on barge in, only a second call, which the host answers on its state.)
 *   - A host that throws (it never should) is answered not_allowed; the test never breaks on a call.
 * The counts per tool feed the usage report (5.2). Pure, no DOM.
 */
import { AnswerGuard, TOOL_BEHAVIOR, isToolName, screenToolCall } from "../../coach/tools";
import type {
  BridgeEvent,
  CoachBlock,
  CoachHost,
  LiveTransport,
  ToolName,
  ToolResult,
} from "../../coach/types";

type Responses = Parameters<LiveTransport["sendToolResponse"]>[0];

export class ToolExecutor {
  /** Calls handled, by id, with what the app did. */
  private applied = new Map<string, { name: string; accepted: boolean }>();
  /** Calls whose tool_applied was sent. */
  private told = new Set<string>();
  /** Cancellations that came before their call. */
  private cancelled = new Set<string>();
  private counts: Partial<Record<ToolName, { ok: number; rejected: number }>> = {};

  constructor(
    private readonly block: CoachBlock,
    private readonly host: () => CoachHost,
    private readonly send: (responses: Responses) => void,
    private readonly push: (e: BridgeEvent) => void,
    private readonly guard: AnswerGuard,
  ) {}

  /** One toolCall message: every call applied in order, answered together at once. */
  handle(calls: { id: string; name: string; args: unknown }[], now: number): void {
    const responses: Responses = [];
    for (const call of calls) {
      if (this.cancelled.delete(call.id) || this.applied.has(call.id)) continue;
      const result = this.apply(call, now);
      this.applied.set(call.id, { name: call.name, accepted: result.accepted });
      if (isToolName(call.name)) {
        const c = (this.counts[call.name] ??= { ok: 0, rejected: 0 });
        if (result.accepted) c.ok++;
        else c.rejected++;
      }
      const scheduling = isToolName(call.name) ? TOOL_BEHAVIOR[call.name].scheduling : undefined;
      responses.push({
        id: call.id,
        name: call.name,
        response: result,
        ...(scheduling ? { scheduling } : {}),
      });
    }
    if (responses.length) this.send(responses);
  }

  /** C-17: a cancellation never undoes what the app did; the coach is told the outcome instead. */
  cancel(ids: string[], now: number): void {
    for (const id of ids) {
      const done = this.applied.get(id);
      if (!done) {
        this.cancelled.add(id);
        continue;
      }
      if (this.told.has(id) || !isToolName(done.name)) continue;
      this.told.add(id);
      this.push({ p: 3, type: "tool_applied", name: done.name, accepted: done.accepted, t: now });
    }
  }

  /** The calls of the segment so far, per tool (5.2 toolCalls). */
  stats(): Partial<Record<ToolName, { ok: number; rejected: number }>> {
    return structuredClone(this.counts);
  }

  private apply(call: { id: string; name: string; args: unknown }, now: number): ToolResult {
    const screened = screenToolCall(this.block, call, this.guard, now);
    if (!screened.ok) return screened.result;
    try {
      return this.host().handleTool(screened.name, screened.args);
    } catch {
      return { accepted: false, reason: "not_allowed" };
    }
  }
}
