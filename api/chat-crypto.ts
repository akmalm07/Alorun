import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class ChatEncryption {
  private key: Buffer;
  constructor(hexKey: string) {
    if (!/^[a-fA-F0-9]{64}$/.test(hexKey))
      throw new Error("Invalid chat encryption key");
    this.key = Buffer.from(hexKey, "hex");
  }
  seal(value: string, owner: string, thread: string, message: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from(`${owner}:${thread}:${message}`));
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64"),
      cipher.getAuthTag().toString("base64"),
      encrypted.toString("base64"),
    ].join(".");
  }
  open(value: string, owner: string, thread: string, message: string): string {
    const [version, iv, tag, content] = value.split(".");
    if (version !== "v1" || !iv || !tag || !content)
      throw new Error("Invalid encrypted chat message");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64"),
    );
    decipher.setAAD(Buffer.from(`${owner}:${thread}:${message}`));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(content, "base64")),
      decipher.final(),
    ]).toString("utf8");
  }
}
