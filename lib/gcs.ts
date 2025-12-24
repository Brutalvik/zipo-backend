// src/lib/gcs.ts
import { Storage } from "@google-cloud/storage";

const GCS_PROJECT_ID = process.env.GCS_PROJECT_ID;
const GCS_BUCKET = process.env.GCS_BUCKET;
const ZIPO_STORAGE_CREDENTIALS = process.env.ZIPO_STORAGE_CREDENTIALS;

if (!GCS_PROJECT_ID) throw new Error("GCS_PROJECT_ID is not set");
if (!GCS_BUCKET) throw new Error("GCS_BUCKET is not set");
if (!ZIPO_STORAGE_CREDENTIALS)
  throw new Error("ZIPO_STORAGE_CREDENTIALS is not set");

export const storage = new Storage({
  projectId: GCS_PROJECT_ID,
  keyFilename: ZIPO_STORAGE_CREDENTIALS,
});

export const gcsBucket = storage.bucket(GCS_BUCKET);

export function gcsPublicUrl(objectPath: string) {
  // Works if bucket is public. If bucket is private, keep storing `path`
  // and later generate signed READ urls on demand.
  return `https://storage.googleapis.com/${GCS_BUCKET}/${encodeURI(
    objectPath
  )}`;
}
