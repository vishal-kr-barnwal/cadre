#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const core = require("../cadre-core");

const PROTOCOL_VERSION = "2025-11-25";
const ROOT = process.env.CADRE_ROOT
  ? path.resolve(process.env.CADRE_ROOT)
  : process.cwd();

const TOOLS = [
  {
    name: "cadre_regen_index",
    description: "Regenerate cadre/tracks.md from per-track metadata.json status.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "cadre_parse_plan",
    description: "Parse a Cadre plan.md and return phases, tasks, and annotations.",
    inputSchema: {
      type: "object",
      properties: {
        planPath: { type: "string" },
        root: { type: "string" },
      },
      required: ["planPath"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_team_status",
    description: "Return team status grouped by owner and track status.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "cadre_available_work",
    description: "Return new, unowned tracks whose dependencies are complete.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "cadre_collision_scan",
    description: "Return cross-track file collisions from plan <!-- files: --> claims.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      additionalProperties: false,
    },
  },
  {
    name: "cadre_review_gate",
    description: "Evaluate whether a track's metadata.review clears the ship/land gate.",
    inputSchema: {
      type: "object",
      properties: {
        trackId: { type: "string" },
        root: { type: "string" },
      },
      required: ["trackId"],
      additionalProperties: false,
    },
  },
  {
    name: "cadre_polyrepo_preflight",
    description: "Run local polyrepo manifest and submodule sanity checks.",
    inputSchema: {
      type: "object",
      properties: { root: { type: "string" } },
      additionalProperties: false,
    },
  },
];

function resolveRoot(args) {
  return path.resolve(args && args.root ? args.root : ROOT);
}

function asTextJson(value) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function toolCall(name, args) {
  const root = resolveRoot(args || {});
  switch (name) {
    case "cadre_regen_index":
      return asTextJson(core.regenIndex(root));
    case "cadre_parse_plan": {
      const planPath = path.resolve(root, args.planPath);
      return asTextJson(core.parsePlanFile(planPath));
    }
    case "cadre_team_status":
      return asTextJson(core.teamStatus(root));
    case "cadre_available_work":
      return asTextJson(core.availableWork(root));
    case "cadre_collision_scan":
      return asTextJson(core.collisionScan(root));
    case "cadre_review_gate":
      return asTextJson(core.reviewGate(root, args.trackId));
    case "cadre_polyrepo_preflight":
      return asTextJson(core.polyrepoPreflight(root));
    default:
      throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
  }
}

function resourceList() {
  return {
    resources: [
      {
        uri: "cadre://tracks",
        name: "Cadre tracks",
        description: "Per-track metadata from cadre/tracks/*/metadata.json",
        mimeType: "application/json",
      },
      {
        uri: "cadre://team-status",
        name: "Cadre team status",
        description: "Team board grouped by owner and status",
        mimeType: "application/json",
      },
      {
        uri: "cadre://collisions",
        name: "Cadre file collisions",
        description: "Cross-track file claim collisions",
        mimeType: "application/json",
      },
    ],
  };
}

function resourceRead(uri) {
  let value;
  if (uri === "cadre://tracks") value = core.listTracks(ROOT).map((track) => track.metadata);
  else if (uri === "cadre://team-status") value = core.teamStatus(ROOT);
  else if (uri === "cadre://collisions") value = core.collisionScan(ROOT);
  else throw Object.assign(new Error(`Unknown resource: ${uri}`), { code: -32602 });
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

function handle(message) {
  const method = message.method;
  const params = message.params || {};
  if (method === "initialize") {
    return {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        resources: { listChanged: false },
        tools: { listChanged: false },
      },
      serverInfo: {
        name: "cadre",
        version: "2.0.0",
      },
    };
  }
  if (method === "notifications/initialized") return undefined;
  if (method === "ping") return {};
  if (method === "tools/list") return { tools: TOOLS };
  if (method === "tools/call") return toolCall(params.name, params.arguments || {});
  if (method === "resources/list") return resourceList();
  if (method === "resources/read") return resourceRead(params.uri);
  throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
}

function send(payload) {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function respond(message, result) {
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  send({ jsonrpc: "2.0", id: message.id, result });
}

function respondError(message, error) {
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  send({
    jsonrpc: "2.0",
    id: message.id,
    error: {
      code: error.code || -32603,
      message: error.message || String(error),
    },
  });
}

let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) return;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!lengthMatch) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(lengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) return;
    const raw = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    let message;
    try {
      message = JSON.parse(raw);
      const result = handle(message);
      if (result !== undefined) respond(message, result);
    } catch (error) {
      respondError(message || { id: null }, error);
    }
  }
});

process.stdin.resume();
