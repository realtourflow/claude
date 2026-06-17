/**
 * S3 helpers — pre-signed PUT/GET URLs + object delete. Mirrors the AWS SDK
 * v2 usage in the legacy Go backend.
 */
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

const FIFTEEN_MINUTES_SECONDS = 60 * 15;

let cached: { client: S3Client; bucket: string } | undefined;

function getClient(): { client: S3Client; bucket: string } {
  if (cached) return cached;
  const e = env();
  cached = {
    client: new S3Client({ region: e.AWS_REGION || "us-east-1" }),
    bucket: e.S3_BUCKET,
  };
  return cached;
}

/**
 * Test seam — lets integration tests inject a mocked S3Client and a fake
 * bucket name without touching env. Pass `undefined` to reset.
 */
export function setS3ClientForTesting(
  client: S3Client | undefined,
  bucket = "test-bucket"
): void {
  if (client === undefined) {
    cached = undefined;
    return;
  }
  cached = { client, bucket };
}

/** Generates a deal-scoped S3 key with a timestamp prefix to avoid collisions. */
export function makeS3Key(dealId: string, fileName: string): string {
  const safe = fileName.split("/").pop()!.replace(/\s+/g, "-");
  return `deals/${dealId}/${Date.now()}/${safe}`;
}

/**
 * Generates an agent-scoped S3 key for a doc template, with a timestamp prefix
 * to avoid collisions. Mirrors agentDocS3Key in
 * the legacy Go backend.
 */
export function makeAgentDocS3Key(agentId: string, fileName: string): string {
  const safe = fileName.split("/").pop()!.replace(/\s+/g, "-");
  return `agent-templates/${agentId}/${Date.now()}/${safe}`;
}

/**
 * Generates an agent-scoped S3 key for an uploaded form (the form-upload
 * pipeline), with a timestamp prefix. Separate `agent-forms/` namespace so it
 * never collides with doc templates (`agent-templates/`) or deal docs.
 */
export function makeAgentFormS3Key(agentId: string, fileName: string): string {
  const safe = fileName.split("/").pop()!.replace(/\s+/g, "-");
  return `agent-forms/${agentId}/${Date.now()}/${safe}`;
}

export async function getUploadUrl(input: {
  key: string;
  contentType?: string;
}): Promise<string> {
  const { client, bucket } = getClient();
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: input.key,
    ContentType: input.contentType ?? "application/octet-stream",
  });
  return getSignedUrl(client, cmd, { expiresIn: FIFTEEN_MINUTES_SECONDS });
}

export async function getDownloadUrl(input: { key: string }): Promise<string> {
  const { client, bucket } = getClient();
  const cmd = new GetObjectCommand({
    Bucket: bucket,
    Key: input.key,
  });
  return getSignedUrl(client, cmd, { expiresIn: FIFTEEN_MINUTES_SECONDS });
}

/**
 * Fetches the full object body as bytes. Used to hand a document's contents to
 * DocuSign. Mirrors downloadS3Object in the legacy Go backend.
 */
export async function getObjectBytes(key: string): Promise<Uint8Array> {
  const { client, bucket } = getClient();
  const result = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key })
  );
  if (!result.Body) {
    throw new Error(`s3 get object ${key}: empty body`);
  }
  // v3 SDK exposes a stream helper that collects the whole body for us.
  return result.Body.transformToByteArray();
}

/**
 * Uploads bytes directly to S3 (server-side put, no pre-signed URL). Used to
 * store server-generated files such as merged disclosure packets.
 */
export async function putObjectBytes(
  key: string,
  bytes: Uint8Array,
  contentType: string
): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
    })
  );
}

/** Best-effort delete. Logs and swallows errors — matches Go behavior. */
export async function deleteObject(key: string): Promise<void> {
  try {
    const { client, bucket } = getClient();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (err) {
    console.warn("s3 delete failed (ignored)", { key, err });
  }
}
