// Read-only measurement of Codex --json logs. Never copies prompts or tool output.
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const runs = process.argv.slice(2).map(path => {
  const events = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  const calls = events.filter(event => event.type === 'item.completed' && event.item?.type === 'mcp_tool_call' && event.item.server === 'cadre').map(event => event.item);
  const stat = statSync(path);
  const usage = events.filter(event => event.type === 'turn.completed').map(event => event.usage);
  const scopeKey = call => JSON.stringify(call.arguments.scope);
  const verificationNodes = new Set(calls.filter(call => call.tool === 'execution_checkpoint' && call.arguments.action?.event === 'record_verification').map(scopeKey));
  const taskStarts = calls.filter(call => call.tool === 'execution_checkpoint' && call.arguments.action?.event === 'start' && (call.arguments.scope?.nodeId ?? '').startsWith('T'));
  const countByTool = Object.fromEntries([...new Set(calls.map(call => call.tool))].sort().map(tool => [tool, calls.filter(call => call.tool === tool).length]));
  const context = calls.filter(call => call.tool === 'context_read');
  return {
    run: basename(path, '-events.jsonl'), completed: usage.length > 0,
    elapsedLogWriteSeconds: Math.round((stat.mtimeMs - stat.birthtimeMs) / 1000),
    cadreCalls: calls.length, failedCadreCalls: calls.filter(call => call.status === 'failed').length, countByTool,
    serializedRequestBytes: calls.reduce((n, call) => n + bytes(call.arguments), 0),
    serializedResponseBytes: calls.reduce((n, call) => n + bytes(call.result ?? call.error), 0),
    context: { calls: context.length, requestBytes: context.reduce((n, call) => n + bytes(call.arguments), 0), responseBytes: context.reduce((n, call) => n + bytes(call.result ?? call.error), 0) },
    verificationStarts: taskStarts.filter(call => verificationNodes.has(scopeKey(call))).length,
    unclassifiedTaskStarts: taskStarts.filter(call => !verificationNodes.has(scopeKey(call))).length,
    clientUsage: usage,
    checkpointSequence: calls.filter(call => ['execution_checkpoint', 'candidate_apply', 'worktree_integration'].includes(call.tool)).map(call => ({ tool: call.tool, ...(call.arguments.action?.event ? { event: call.arguments.action.event, node: call.arguments.scope.nodeId } : {}), ...(call.arguments.request?.mode ? { mode: call.arguments.request.mode } : {}) }))
  };
});
console.log(JSON.stringify({ schemaVersion: 1, byteDefinition: 'UTF-8 JSON serialization of captured MCP argument/result payloads, excluding JSON-RPC framing. Token counters are client-reported and are not inferred from bytes. Manual starts are identified by a matching composite verification checkpoint in the same log; unmatched task starts are reported separately.', runs }, null, 2));
