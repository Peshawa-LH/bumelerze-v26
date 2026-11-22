import { readFileSync } from "fs";
import { join } from "path";

/**
 * Security audit CI-08: the functions answer a failure with a fixed text and
 * the request id; the reason (Postgres and storage errors, upstream addresses,
 * the request schema) goes to the function log only. These entry points have
 * no unit harness of their own (they call Deno.serve), so the rule is pinned on
 * their source.
 */
const read = (path: string) => readFileSync(join(__dirname, "..", "..", path), "utf8");

describe("error replies carry no internal detail", () => {
  it("validation failures do not echo the schema", () => {
    for (const file of ["ingest-events/index.ts", "aggregate-felt-cells/index.ts"]) {
      const code = read(file);
      expect(code).not.toMatch(/jsonError\([^;]*parsed\.error\.flatten\(\)/s);
      expect(code).toContain('return jsonError(400, "invalid_request", "Request failed validation.", requestId);');
    }
  });

  it("server failures answer a fixed text", () => {
    expect(read("send-alerts/handler.ts")).toContain(
      'return error(500, "send_failed", "Sending failed; see the function log.", requestId);',
    );
    expect(read("purge-home-photos/index.ts")).toContain(
      'return jsonError(500, "purge_failed", "Purge failed; see the function log.", requestId);',
    );
    const ingest = read("ingest-events/index.ts");
    expect(ingest).toContain('`Channel "${channelDef.id}" failed; see the function log.`');
    expect(ingest).not.toMatch(/failed: \$\{err instanceof Error/);
  });
});
