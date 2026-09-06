import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCadreServer } from "../src/mcp/server.js";
import { clientResultFormat } from "../src/mcp/results.js";

test("result format recognizes verified clients and falls back conservatively", () => {
  for (const name of ["codex", "codex_cli_rs", "codex-mcp-client", "codex_desktop"]) {
    assert.equal(clientResultFormat({ name, version: "0.148.0" }), "structured");
  }
  for (const version of ["2.0.21", "2.1.0", "3.0.0"]) {
    assert.equal(clientResultFormat({ name: "claude-code", version }), "structured");
  }
  for (const version of ["1.9.99", "2.0.20", "unknown"]) {
    assert.equal(clientResultFormat({ name: "claude-code", version }), "text");
  }
  for (const name of ["zed", "unknown", "proxy-for-codex", "claude-desktop"]) {
    assert.equal(clientResultFormat({ name, version: "99.0.0" }), "text");
  }
  assert.equal(clientResultFormat(undefined), "text");
});

test("initialized client controls schemas and success, error, and template serialization per server", async () => {
  await Promise.all(["codex_cli_rs", "claude-code", "zed", "unknown"].map(async (name) => {
    const server = createCadreServer();
    const client = new Client({ name, version: "2.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const structured = name === "codex_cli_rs" || name === "claude-code";
      const tools = await client.listTools();
      assert.ok(tools.tools.every((tool) => Boolean(tool.outputSchema) === structured));
      for (const request of [
        { name: "styleguide_resolve", arguments: { technologies: ["typescript"] } },
        { name: "state_validate", arguments: { projectRoot: "/" } },
        { name: "template_get_many", arguments: { ids: ["track/plan"], contentMode: "text" } },
        { name: "template_get_many", arguments: { ids: ["track/plan"], contentMode: "embedded_resource" } }
      ]) {
        const response = await client.callTool(request);
        const content = response.content as Array<{ type: string; text?: string; resource?: { text: string } }>;
        assert.equal(response.isError === true, request.name === "state_validate");
        let payload: Record<string, unknown>;
        if (structured && !response.isError) {
          assert.deepEqual(content, []);
          assert.ok(response.structuredContent);
          payload = response.structuredContent as Record<string, unknown>;
        } else {
          assert.equal(response.structuredContent, undefined);
          payload = JSON.parse(content.at(-1)!.text!);
          assert.equal(content.length, request.name === "template_get_many" ? 2 : 1);
        }
        if (request.name === "template_get_many") {
          const templates = payload.templates as Array<{ content?: string }>;
          if (structured) assert.match(templates[0]!.content!, /^# Plan:/);
          else {
            assert.equal(templates[0]!.content, undefined);
            assert.match(content[0]!.text ?? content[0]!.resource!.text, /# Plan:/);
          }
        }
        if (request.name === "state_validate") assert.ok(payload.error);
      }
    } finally {
      await client.close();
      await server.close();
    }
  }));
});
