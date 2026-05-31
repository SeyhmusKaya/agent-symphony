import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { appDataDir } from "./fleet.js";

// Kullanicinin gizli bilgileri (sifre, API key, token).
// appData altinda tutulur — repo disi, asla commit edilmez.

type VaultData = Record<string, string>;

export class Vault {
  private file = join(appDataDir(), "vault.json");

  private read(): VaultData {
    if (!existsSync(this.file)) return {};
    try {
      const raw = readFileSync(this.file, "utf8").trim();
      return raw ? (JSON.parse(raw) as VaultData) : {};
    } catch {
      return {};
    }
  }

  private write(data: VaultData): void {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(data, null, 2), "utf8");
  }

  set(key: string, value: string): void {
    const data = this.read();
    data[key] = value;
    this.write(data);
  }

  get(key: string): string | undefined {
    return this.read()[key];
  }

  delete(key: string): boolean {
    const data = this.read();
    if (!(key in data)) return false;
    delete data[key];
    this.write(data);
    return true;
  }

  keys(): string[] {
    return Object.keys(this.read());
  }
}
