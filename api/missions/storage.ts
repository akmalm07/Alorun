import { createClient } from "@supabase/supabase-js";
import { missionFolder, missionInputName } from "../../src/domain/missions";
import { MissionError } from "./errors";

export interface BucketDriver {
  assertPrivate(): Promise<void>;
  list(prefix: string): Promise<{ name: string; size: number }[]>;
  read(key: string): Promise<string>;
  write(key: string, content: string, upsert: boolean): Promise<void>;
}
export class SupabaseBucket implements BucketDriver {
  private client: ReturnType<typeof createClient>;
  constructor(
    url: string,
    key: string,
    private bucket: string,
  ) {
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }),
      },
    });
  }
  async assertPrivate() {
    const { data, error } = await this.client.storage.getBucket(this.bucket);
    if (error || !data || data.public)
      throw new MissionError(
        503,
        "Mission storage must be an available private bucket.",
      );
  }
  async list(prefix: string) {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(prefix, { limit: 11, sortBy: { column: "name", order: "asc" } });
    if (error)
      throw new MissionError(
        503,
        "Mission files are unavailable. Try again later.",
      );
    return (data ?? [])
      .filter((item) => item.id)
      .map((item) => ({
        name: item.name,
        size: Number(item.metadata?.size ?? 0),
      }));
  }
  async read(key: string) {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .download(key);
    if (error || !data) throw new MissionError(404, "Mission file not found");
    if (data.size > 64 * 1024)
      throw new MissionError(400, "Mission input exceeds the file-size limit.");
    return data.text();
  }
  async write(key: string, content: string, upsert: boolean) {
    if (new TextEncoder().encode(content).length > 64 * 1024)
      throw new MissionError(400, "Mission files must be at most 64 KB.");
    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(key, content, {
        contentType: "text/plain; charset=utf-8",
        upsert,
      });
    if (error) throw new MissionError(503, "Could not save the mission file.");
  }
}
/** Credentials stay in the trusted adapter; a mission gets only these scoped capabilities. */
export class MissionFiles {
  readonly prefix: string;
  constructor(
    private driver: BucketDriver,
    ownerId: string,
    missionId: string,
    folder: string,
  ) {
    this.prefix = missionFolder(ownerId, missionId, folder);
  }
  async listInputs() {
    await this.driver.assertPrivate();
    const files = await this.driver.list(`${this.prefix}/inputs`);
    if (files.length > 10)
      throw new MissionError(
        400,
        "Keep at most 10 input files in this mission folder.",
      );
    return files.map((file) => ({
      ...file,
      name: missionInputName(file.name),
    }));
  }
  async putInput(name: string, content: string) {
    name = missionInputName(name);
    const files = await this.listInputs();
    if (files.length >= 10 && !files.some((file) => file.name === name))
      throw new MissionError(400, "This mission already has 10 input files.");
    await this.driver.write(`${this.prefix}/inputs/${name}`, content, true);
  }
  async readInput(name: string) {
    await this.driver.assertPrivate();
    return this.driver.read(`${this.prefix}/inputs/${missionInputName(name)}`);
  }
  async modelInputs() {
    const files = (await this.listInputs()).slice(0, 4);
    return Promise.all(
      files.map(async (file) => ({
        name: file.name,
        content: (await this.readInput(file.name)).slice(0, 4000),
      })),
    );
  }
  private outputKey(runId: string) {
    if (!/^[a-f0-9-]{36}$/i.test(runId))
      throw new MissionError(400, "Invalid run ID");
    return `${this.prefix}/outputs/${runId}.md`;
  }
  async writeOutput(runId: string, markdown: string) {
    await this.driver.assertPrivate();
    await this.driver.write(this.outputKey(runId), markdown, false);
    return `outputs/${runId}.md`;
  }
  async readOutput(runId: string) {
    await this.driver.assertPrivate();
    return this.driver.read(this.outputKey(runId));
  }
}
