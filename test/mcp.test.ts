import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { tmpdir, write } from "./helpers.js";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "index.js");

/** Drive the stdio server with one process and collect its replies. */
function converse(messages: unknown[], cwd: string): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, "mcp"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => (out += c));
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolve(out.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    child.stdin.end(messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  });
}

function project(): string {
  const p = tmpdir("ctxdiet-mcp-");
  write(p, "CLAUDE.md", "# Rules\n\nA duplicated instruction line right here.\nA duplicated instruction line right here.\n");
  return p;
}

test("initialize negotiates a protocol version and names the server", async () => {
  const [res] = await converse(
    [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }],
    project()
  );
  const result = res?.["result"] as Record<string, unknown>;
  assert.equal(result["protocolVersion"], "2025-06-18");
  assert.equal((result["serverInfo"] as Record<string, unknown>)["name"], "ctxdiet");
  assert.ok(result["capabilities"]);
});

test("an unsupported protocol version falls back to one we speak", async () => {
  const [res] = await converse(
    [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }],
    project()
  );
  assert.equal((res?.["result"] as Record<string, unknown>)["protocolVersion"], "2025-06-18");
});

test("notifications are never answered", async () => {
  // A reply to a notification is a protocol violation and desyncs the client.
  const replies = await converse(
    [
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 7, method: "ping" },
    ],
    project()
  );
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.["id"], 7);
});

test("tools are advertised read-only", async () => {
  const [res] = await converse([{ jsonrpc: "2.0", id: 1, method: "tools/list" }], project());
  const tools = (res?.["result"] as { tools: Array<Record<string, unknown>> }).tools;
  assert.deepEqual(tools.map((t) => t["name"]), ["ctxdiet_scan", "ctxdiet_plan"]);
  for (const t of tools) {
    const ann = t["annotations"] as Record<string, unknown>;
    assert.equal(ann["readOnlyHint"], true, `${String(t["name"])} must be read-only`);
    assert.equal(ann["destructiveHint"], false);
  }
});

test("scan returns both a summary and structured content", async () => {
  const p = project();
  const [res] = await converse(
    [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ctxdiet_scan", arguments: { path: p } } }],
    p
  );
  const result = res?.["result"] as Record<string, unknown>;
  const content = result["content"] as Array<Record<string, unknown>>;
  assert.match(String(content[0]?.["text"]), /Grade [A-F]\./);
  const structured = result["structuredContent"] as Record<string, unknown>;
  assert.equal(structured["tool"], "ctxdiet");
  assert.ok(Array.isArray(structured["findings"]));
});

test("plan is a dry run and writes nothing", async () => {
  const p = project();
  const before = await import("node:fs").then((fs) => fs.readFileSync(path.join(p, "CLAUDE.md"), "utf8"));
  const [res] = await converse(
    [{ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ctxdiet_plan", arguments: { path: p } } }],
    p
  );
  const structured = (res?.["result"] as Record<string, unknown>)["structuredContent"] as Record<string, unknown>;
  assert.equal(structured["dryRun"], true);
  const after = await import("node:fs").then((fs) => fs.readFileSync(path.join(p, "CLAUDE.md"), "utf8"));
  assert.equal(after, before, "planning must not modify anything");
});

test("no write tool is exposed over MCP", async () => {
  const [list] = await converse([{ jsonrpc: "2.0", id: 1, method: "tools/list" }], project());
  const names = (list?.["result"] as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  assert.ok(!names.some((n) => /fix|apply|write|trim/.test(n)), `unexpected write tool in ${names.join(",")}`);
});

test("an unknown tool and malformed input produce JSON-RPC errors, not a crash", async () => {
  const replies = await converse(
    [
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "nope" } },
      { jsonrpc: "2.0", id: 2, method: "no/such/method" },
    ],
    project()
  );
  assert.equal((replies[0]?.["error"] as Record<string, unknown>)["code"], -32602);
  assert.equal((replies[1]?.["error"] as Record<string, unknown>)["code"], -32601);
});
