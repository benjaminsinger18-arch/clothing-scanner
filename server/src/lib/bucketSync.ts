// Optional persistence layer for the two append-only JSONL logs
// (correctionLog.ts, classificationLog.ts) on top of a Hugging Face Storage
// Bucket, accessed via its S3-compatible gateway (https://s3.hf.co) — because
// Render's free tier has no persistent disk (see both log files' own doc
// comments) and this project has no other database.
//
// Strategy: restore-on-startup, sync-on-write.
//   - restoreFromBucket(): called once per log file at server startup, before
//     app.listen(...). Downloads the bucket object (if any) to the local path,
//     repopulating history that survived a Render restart even though local
//     disk didn't. Never throws — startup must proceed with local-only
//     behavior no matter what goes wrong here (first-ever run with no object
//     yet, network error, bad credentials, timeout, ...).
//   - syncToBucket(): called after every local appendFileSync succeeds.
//     Fire-and-forget — re-uploads the ENTIRE current local file content as
//     one object (simplest correct approach; these files are tiny, so a full
//     overwrite on every write is cheap and needs no diffing/append-in-place
//     against S3). Never lets a failure propagate to the caller, which must
//     not know or care whether the sync succeeded.
//
// Entirely optional: if the 4 env vars below aren't all set, isBucketSyncConfigured()
// short-circuits before any AWS SDK client is constructed or any network call is
// made — matching how every other optional integration in this codebase
// (Vision, Gemini) degrades to silent no-op when unconfigured.
//
// One-time manual setup this module does NOT do for you (see server/.env.example
// and README.md): 1) create the bucket itself (huggingface.co/new-bucket, or
// `hf buckets create <name>`), 2) generate S3 credentials from an HF token with
// Write scope (huggingface.co/settings/tokens -> token's dropdown -> "Generate
// S3 credentials").

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { S3Client, PutObjectCommand, GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";

const RESTORE_TIMEOUT_MS = 8000; // must not hang server startup

let configured: boolean | null = null;

/** Cached after first call. Zero AWS SDK activity if any of the 4 vars is unset —
 * that's the default/common case (bucket sync not set up), so this must be cheap
 * and side-effect-free. */
export function isBucketSyncConfigured(): boolean {
  if (configured === null) {
    configured = Boolean(
      process.env.HF_BUCKET_S3_ENDPOINT &&
        process.env.HF_BUCKET_NAME &&
        process.env.HF_BUCKET_ACCESS_KEY_ID &&
        process.env.HF_BUCKET_SECRET_ACCESS_KEY
    );
  }
  return configured;
}

let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: "us-east-1", // required by the gateway even though buckets aren't region-specific
      endpoint: process.env.HF_BUCKET_S3_ENDPOINT, // full https://s3.hf.co/<namespace>
      forcePathStyle: true, // required — NOT virtual-hosted-style addressing
      // Recent AWS SDK v3 versions default to always attempting request/response
      // checksums (WHEN_SUPPORTED), which the HF gateway doesn't support the same
      // way S3 itself does; WHEN_REQUIRED matches the boto3/AWS-CLI-equivalent
      // settings HF's own docs show (request_checksum_calculation /
      // response_checksum_validation = when_required). Verified directly against
      // the installed @aws-sdk/checksums package's actual constants.d.ts.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: process.env.HF_BUCKET_ACCESS_KEY_ID!,
        secretAccessKey: process.env.HF_BUCKET_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

function getBucketName(): string {
  return process.env.HF_BUCKET_NAME!;
}

/** Downloads remoteKey from the bucket to localPath, overwriting any local
 * content. No-ops silently if bucket sync isn't configured. Never throws —
 * callers (server startup) must proceed with local-only behavior regardless
 * of outcome. */
export async function restoreFromBucket(localPath: string, remoteKey: string): Promise<void> {
  if (!isBucketSyncConfigured()) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESTORE_TIMEOUT_MS);

  try {
    const response = await getClient().send(new GetObjectCommand({ Bucket: getBucketName(), Key: remoteKey }), {
      abortSignal: controller.signal,
    });
    const body = await response.Body?.transformToString("utf8");
    if (body !== undefined) {
      mkdirSync(dirname(localPath), { recursive: true });
      writeFileSync(localPath, body, "utf8");
      console.log(`[bucketSync] Restored ${remoteKey} from bucket to ${localPath}`);
    }
  } catch (err) {
    if (err instanceof NoSuchKey) {
      // Expected on first-ever run (or if this key was never written yet) — not a
      // real failure, nothing to restore.
      console.log(`[bucketSync] No existing ${remoteKey} in bucket yet — starting fresh.`);
    } else {
      console.warn(`[bucketSync] Failed to restore ${remoteKey} from bucket (continuing with local-only state):`, err);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Fire-and-forget: re-uploads localPath's full current content to remoteKey.
 * Not awaited by callers — logCorrection/logClassification must not know or
 * care whether this succeeds. Catches everything internally. No-ops silently
 * if bucket sync isn't configured. */
export function syncToBucket(localPath: string, remoteKey: string): void {
  if (!isBucketSyncConfigured()) return;

  void (async () => {
    try {
      const content = readFileSync(localPath, "utf8");
      await getClient().send(
        new PutObjectCommand({ Bucket: getBucketName(), Key: remoteKey, Body: content, ContentType: "application/x-ndjson" })
      );
    } catch (err) {
      console.warn(`[bucketSync] Failed to sync ${remoteKey} to bucket (local write already succeeded):`, err);
    }
  })();
}
