import { execFileSync } from "node:child_process";

export type CommitType = "feat" | "fix" | "refactor" | "chore" | "docs" | "test";

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

export function isRepo(cwd: string): boolean {
  try {
    git(["rev-parse", "--is-inside-work-tree"], cwd);
    return true;
  } catch {
    return false;
  }
}

export function hasChanges(cwd: string): boolean {
  return git(["status", "--porcelain"], cwd).length > 0;
}

export function changedFiles(cwd: string): string[] {
  const out = git(["status", "--porcelain"], cwd);
  if (!out) return [];
  return out
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

export function fileDiff(cwd: string, file: string): string {
  try {
    return git(["diff", "HEAD", "--", file], cwd);
  } catch {
    return "";
  }
}

export function formatCommit(type: CommitType, subject: string, body?: string): string {
  const head = `${type}: ${subject}`;
  return body ? `${head}\n\n${body}` : head;
}

export interface CommitResult {
  committed: boolean;
  hash: string;
  message: string;
}

export function commitAll(cwd: string, message: string): CommitResult {
  if (!hasChanges(cwd)) {
    return { committed: false, hash: "", message };
  }
  git(["add", "-A"], cwd);
  git(["commit", "-m", message], cwd);
  const hash = git(["rev-parse", "--short", "HEAD"], cwd);
  return { committed: true, hash, message };
}

export function checkpoint(cwd: string, label: string): CommitResult {
  return commitAll(cwd, formatCommit("chore", `checkpoint - ${label}`));
}

export function push(cwd: string, remote = "origin", branch?: string): string {
  const target = branch ?? git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  return git(["push", remote, target], cwd);
}
