import * as fs from "node:fs";
import * as path from "node:path";

/**
 * A1.4 tripwire: once CAPTCHA protection is on in Supabase Auth, any call to
 * a protected endpoint without a Turnstile token is refused — for a guest
 * that means no session, and felt reports that never leave the phone. So
 * these calls may live in ONE file only, `src/features/captcha/auth.ts`,
 * which always asks for a token first. A new call anywhere else fails here:
 * add a helper to auth.ts instead.
 */

const REPO_ROOT = path.join(__dirname, "../../../..");
const ALLOWED_FILE = path.join("src", "features", "captcha", "auth.ts");

/** Supabase Auth methods whose endpoints check the CAPTCHA token. */
const PROTECTED_METHODS = [
  "signInAnonymously",
  "signInWithPassword",
  "signUp",
  "signInWithOtp",
  "resetPasswordForEmail",
  "resend",
];
const CALL_PATTERN = new RegExp(
  `\\bauth\\s*\\.\\s*(${PROTECTED_METHODS.join("|")})\\s*\\(`,
  "g",
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "__tests__" ||
      entry.name === "__fixtures__"
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Comments may name the methods; only code counts. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("protected Supabase Auth calls", () => {
  const files = [
    ...sourceFiles(path.join(REPO_ROOT, "src")),
    ...sourceFiles(path.join(REPO_ROOT, "app")),
  ];

  it("finds the app's source files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("are made only in src/features/captcha/auth.ts (which sends the token)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const relative = path.relative(REPO_ROOT, file);
      if (relative === ALLOWED_FILE) {
        continue;
      }
      const code = withoutComments(fs.readFileSync(file, "utf8"));
      for (const match of code.matchAll(CALL_PATTERN)) {
        offenders.push(`${relative}: auth.${match[1]}(`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the allowed file does make them (the scan is looking at the right thing)", () => {
    const code = fs.readFileSync(path.join(REPO_ROOT, ALLOWED_FILE), "utf8");
    expect(code).toMatch(/auth\.signInAnonymously\(/);
    expect(code).toMatch(/auth\.signInWithPassword\(/);
  });
});
