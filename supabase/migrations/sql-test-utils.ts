import { readFileSync } from "fs";
import { join } from "path";

/**
 * Helpers for the static migration tests: read a migration, strip its `--`
 * comments (so a comment can never satisfy or break an assertion), and cut
 * one function body out of it.
 */
export function readMigration(file: string): string {
  return readFileSync(join(__dirname, file), "utf8");
}

export function stripComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

export function readCode(file: string): string {
  return stripComments(readMigration(file));
}

/** The text of `create or replace function public.<name>(...) ... $$ ... $$;`. */
export function functionSource(code: string, name: string): string {
  const start = code.search(
    new RegExp(`create or replace function public\\.${name}\\s*\\(`, "i"),
  );
  if (start < 0) {
    throw new Error(`function ${name} not found`);
  }
  const rest = code.slice(start);
  const end = rest.search(/\$\$;/);
  return end < 0 ? rest : rest.slice(0, end + 3);
}

/** Names of every `create table [if not exists] public.<name>`. */
export function createdTables(code: string): string[] {
  return [...code.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)].map(
    (match) => match[1] as string,
  );
}

/** Names of every `create or replace function public.<name>`. */
export function createdFunctions(code: string): string[] {
  return [...code.matchAll(/create or replace function public\.(\w+)\s*\(/gi)].map(
    (match) => match[1] as string,
  );
}
