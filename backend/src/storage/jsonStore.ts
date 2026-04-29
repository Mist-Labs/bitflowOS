import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class JsonStore<T> {
  constructor(private readonly filePath: string, private readonly emptyValue: T[]) {}

  static forCollection<T>(dataDir: string, name: string): JsonStore<T> {
    return new JsonStore<T>(join(dataDir, `${name}.json`), []);
  }

  async all(): Promise<T[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as T[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [...this.emptyValue];
      throw error;
    }
  }

  async upsert(record: T, match: (candidate: T) => boolean): Promise<T> {
    const records = await this.all();
    const index = records.findIndex(match);
    if (index >= 0) records[index] = record;
    else records.push(record);
    await this.writeAll(records);
    return record;
  }

  async find(match: (candidate: T) => boolean): Promise<T | undefined> {
    return (await this.all()).find(match);
  }

  private async writeAll(records: T[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
    await rename(tmpPath, this.filePath);
  }
}
