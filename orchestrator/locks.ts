import { resolve } from "node:path";

export class FileCoordinator {
  private locks = new Map<string, string>();

  private key(path: string): string {
    return resolve(path).toLowerCase();
  }

  owner(path: string): string | null {
    return this.locks.get(this.key(path)) ?? null;
  }

  isFree(paths: string[], agent: string): boolean {
    return paths.every((p) => {
      const o = this.locks.get(this.key(p));
      return o === undefined || o === agent;
    });
  }

  acquire(paths: string[], agent: string): boolean {
    if (!this.isFree(paths, agent)) return false;
    for (const p of paths) this.locks.set(this.key(p), agent);
    return true;
  }

  release(paths: string[], agent: string): void {
    for (const p of paths) {
      const k = this.key(p);
      if (this.locks.get(k) === agent) this.locks.delete(k);
    }
  }

  releaseAll(agent: string): void {
    for (const [k, o] of this.locks) {
      if (o === agent) this.locks.delete(k);
    }
  }
}
