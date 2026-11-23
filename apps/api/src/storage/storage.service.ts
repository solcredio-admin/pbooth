import { Inject, Injectable, Logger } from "@nestjs/common";
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { CONFIG, type Config } from "../config.js";

export const PUT_SECONDS = 600; // an upload link lives 10 minutes
export const GET_SECONDS = 900; // a viewing/download link lives 15 minutes

/**
 * The private photo bucket. Browsers never get bucket credentials: they get short-lived signed
 * links for one object and one action. Presigned URLs are never logged.
 */
@Injectable()
export class StorageService {
  private readonly log = new Logger("Storage");
  readonly enabled: boolean;
  readonly bucket: string;
  private readonly s3: S3Client | null;

  constructor(@Inject(CONFIG) cfg: Config) {
    this.enabled = !!(cfg.S3_ENDPOINT && cfg.S3_BUCKET && cfg.S3_ACCESS_KEY_ID && cfg.S3_SECRET_ACCESS_KEY);
    this.bucket = cfg.S3_BUCKET ?? "";
    this.s3 = this.enabled ? new S3Client({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      forcePathStyle: true, // https://<endpoint>/<bucket>/<key>: works with R2 and MinIO, one origin for the CSP
      credentials: { accessKeyId: cfg.S3_ACCESS_KEY_ID!, secretAccessKey: cfg.S3_SECRET_ACCESS_KEY! },
      // Only add checksums we ask for; automatic ones break presigned uploads on R2.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }) : null;
    if (!this.enabled) this.log.warn("Photo storage is not configured (S3_* variables): photos won't be saved.");
  }

  private client() {
    if (!this.s3) throw new Error("Storage not configured");
    return this.s3;
  }

  /**
   * A one-object upload link. Size, type and SHA-256 are part of the signature: the bucket refuses
   * the upload if any of them differ, so a corrupted or swapped file can't land under this key.
   */
  async presignPut(key: string, o: { contentType: string; size: number; sha256Hex: string }) {
    const checksum = Buffer.from(o.sha256Hex, "hex").toString("base64");
    const url = await getSignedUrl(this.client(), new PutObjectCommand({
      Bucket: this.bucket, Key: key, ContentType: o.contentType, ContentLength: o.size, ChecksumSHA256: checksum,
    }), {
      expiresIn: PUT_SECONDS,
      signableHeaders: new Set(["content-type", "content-length", "x-amz-checksum-sha256"]), // all three must be sent as signed
      unhoistableHeaders: new Set(["x-amz-checksum-sha256"]),
    });
    return { url, headers: { "content-type": o.contentType, "x-amz-checksum-sha256": checksum }, expiresAt: new Date(Date.now() + PUT_SECONDS * 1000) };
  }

  async head(key: string) {
    try {
      const r = await this.client().send(new HeadObjectCommand({ Bucket: this.bucket, Key: key, ChecksumMode: "ENABLED" }));
      return { size: r.ContentLength ?? 0, sha256: r.ChecksumSHA256 ? Buffer.from(r.ChecksumSHA256, "base64").toString("hex") : null };
    } catch (e) {
      if ((e as { name?: string }).name === "NotFound" || (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }

  async get(key: string): Promise<Buffer> {
    const r = await this.client().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }

  async stream(key: string): Promise<Readable> {
    const r = await this.client().send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return r.Body as Readable;
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client().send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  /** A viewing link; with a filename it downloads instead of opening. */
  presignGet(key: string, downloadName?: string) {
    return getSignedUrl(this.client(), new GetObjectCommand({
      Bucket: this.bucket, Key: key,
      ...(downloadName ? { ResponseContentDisposition: `attachment; filename="${downloadName.replace(/[^\w.-]/g, "_")}"` } : {}),
    }), { expiresIn: GET_SECONDS });
  }

  /** Objects under a prefix (all pages), newest first. */
  async list(prefix: string) {
    const out: { key: string; size: number; at: Date }[] = [];
    let token: string | undefined;
    do {
      const r = await this.client().send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) out.push({ key: o.Key, size: o.Size ?? 0, at: o.LastModified ?? new Date(0) });
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out.sort((a, b) => b.at.getTime() - a.at.getTime());
  }

  async delete(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      if (chunk.length) await this.client().send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
    }
  }

  /**
   * Proves the bucket works the way pbooth relies on: write/read/delete, a signed browser-style
   * upload, and that a tampered upload is refused (the bucket checks the SHA-256).
   */
  async check() {
    if (!this.enabled) return { ok: false, steps: [{ name: "configured", ok: false, detail: "S3_* variables are not set" }] };
    const steps: { name: string; ok: boolean; detail: string }[] = [];
    const key = `_pbooth-check/${Date.now()}`;
    const body = Buffer.from(`pbooth storage check ${new Date().toISOString()} `.repeat(20));
    const sha256Hex = createHash("sha256").update(body).digest("hex");
    try {
      await this.put(`${key}-direct.txt`, body, "text/plain");
      steps.push({ name: "write + read", ok: (await this.get(`${key}-direct.txt`)).equals(body), detail: `bucket ${this.bucket}` });

      const up = await this.presignPut(`${key}-signed.jpg`, { contentType: "image/jpeg", size: body.length, sha256Hex });
      const good = await fetch(up.url, { method: "PUT", body, headers: up.headers });
      steps.push({ name: "signed upload", ok: good.ok, detail: good.ok ? "accepted" : `refused (${good.status})` });

      const bad = Buffer.from(body); bad[0] ^= 1;
      const evil = await this.presignPut(`${key}-tampered.jpg`, { contentType: "image/jpeg", size: body.length, sha256Hex });
      const tampered = await fetch(evil.url, { method: "PUT", body: bad, headers: evil.headers });
      steps.push({ name: "tampered upload refused", ok: !tampered.ok, detail: tampered.ok ? "the bucket accepted it (pbooth's own checksum check still rejects such files)" : `refused (${tampered.status})` });

      const head = await this.head(`${key}-signed.jpg`);
      steps.push({ name: "checksum reported", ok: head?.sha256 === sha256Hex, detail: head?.sha256 ? "matches" : "not reported by the bucket" });
    } catch (e) {
      steps.push({ name: "error", ok: false, detail: (e as Error).message });
    } finally {
      await this.delete([`${key}-direct.txt`, `${key}-signed.jpg`, `${key}-tampered.jpg`]).catch(() => undefined);
    }
    return { ok: steps.every((s) => s.ok), steps };
  }
}
