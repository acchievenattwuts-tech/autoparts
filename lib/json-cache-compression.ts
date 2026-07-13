import { gzip, gunzip } from "node:zlib";

const GZIP_LEVEL = 6;

const gzipAsync = (input: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    gzip(input, { level: GZIP_LEVEL }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });

const gunzipAsync = (input: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    gunzip(input, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });

/**
 * Keep large JSON-safe values below Next.js' 2 MiB Data Cache entry limit.
 * Compression is storage-only: callers receive the original JSON shape after
 * `decompressJsonFromCache`, so application and search behavior stay unchanged.
 */
export async function compressJsonForCache(value: unknown): Promise<string> {
  const json = JSON.stringify(value);
  if (typeof json !== "string") {
    throw new TypeError("Cache compression requires a JSON-serializable value");
  }

  const compressed = await gzipAsync(Buffer.from(json, "utf8"));
  return compressed.toString("base64");
}

export async function decompressJsonFromCache<T>(payload: string): Promise<T> {
  const compressed = Buffer.from(payload, "base64");
  const json = (await gunzipAsync(compressed)).toString("utf8");
  return JSON.parse(json) as T;
}
