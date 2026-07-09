import { mkdir, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { JsonRecord } from "../types.js";

export class JsonlLogger {
  constructor(private readonly filePath: string) {}

  async log(event: string, payload: JsonRecord = {}): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      event,
      ...payload
    });
    await appendFile(this.filePath, `${line}\n`, "utf8");
  }
}
