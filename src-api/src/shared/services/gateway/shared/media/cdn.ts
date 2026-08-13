/**
 * CDN Upload Service
 *
 * Uploads media files to S3-compatible object storage (Cloudflare R2, AWS S3, etc.)
 * and returns presigned or public URLs for embedding in chat messages.
 *
 * Uses raw S3 REST API with AWS Signature V4 — no SDK dependency required.
 * Falls back to public URL if the bucket is public.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('CdnUpload');

export interface CdnConfig {
  /** S3-compatible endpoint (e.g. https://<account>.r2.cloudflarestorage.com) */
  endpoint: string;
  /** Bucket name */
  bucket: string;
  /** Access key ID */
  accessKeyId: string;
  /** Secret access key */
  secretAccessKey: string;
  /** AWS region (use 'auto' for R2) */
  region: string;
  /** Optional public URL prefix (e.g. https://cdn.example.com) for public buckets */
  publicUrlPrefix?: string;
  /** Presigned URL expiry in seconds (default: 7 days) */
  presignedExpirySecs?: number;
  /** Optional path prefix within bucket (e.g. 'media/') */
  pathPrefix?: string;
}

const MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
};

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * Upload a file to S3-compatible storage and return its URL.
 *
 * If publicUrlPrefix is configured, returns a direct public URL.
 * Otherwise, generates a presigned GET URL.
 */
export async function uploadToCdn(
  filePath: string,
  config: CdnConfig,
): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const contentType = getMimeType(filePath);
  const prefix = config.pathPrefix ?? 'gateway-media/';
  const objectKey = `${prefix}${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${fileName}`;

  // PUT object using S3 REST API with AWS Signature V4
  const endpoint = config.endpoint.replace(/\/$/, '');
  const url = `${endpoint}/${config.bucket}/${objectKey}`;
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
  const amzDate = `${dateStamp}T${now.toISOString().replace(/[-:]/g, '').slice(9, 15)}Z`;
  const region = config.region || 'auto';

  // Create canonical request for AWS Signature V4
  const payloadHash = crypto
    .createHash('sha256')
    .update(fileBuffer)
    .digest('hex');

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Length': String(fileBuffer.length),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    host: new URL(endpoint).host,
  };

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k]}\n`)
    .join('');

  const canonicalRequest = [
    'PUT',
    `/${config.bucket}/${objectKey}`,
    '', // query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  // Derive signing key
  const kDate = hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...headers,
      Authorization: authorization,
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`CDN upload failed (${response.status}): ${body}`);
  }

  logger.info(`Uploaded ${fileName} to CDN: ${objectKey}`);

  // Return public URL if configured, otherwise generate presigned URL
  if (config.publicUrlPrefix) {
    const publicBase = config.publicUrlPrefix.replace(/\/$/, '');
    return `${publicBase}/${objectKey}`;
  }

  return generatePresignedUrl(config, objectKey);
}

/**
 * Generate a presigned GET URL for an S3 object.
 */
function generatePresignedUrl(config: CdnConfig, objectKey: string): string {
  const endpoint = config.endpoint.replace(/\/$/, '');
  const region = config.region || 'auto';
  const expiry = config.presignedExpirySecs ?? 7 * 24 * 60 * 60; // 7 days
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').slice(0, 8);
  const amzDate = `${dateStamp}T${now.toISOString().replace(/[-:]/g, '').slice(9, 15)}Z`;
  const host = new URL(endpoint).host;

  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
  const credential = `${config.accessKeyId}/${credentialScope}`;

  const queryParams = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiry),
    'X-Amz-SignedHeaders': 'host',
  });

  // Sort query params for canonical request
  queryParams.sort();

  const canonicalRequest = [
    'GET',
    `/${config.bucket}/${objectKey}`,
    queryParams.toString(),
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');

  queryParams.set('X-Amz-Signature', signature);

  return `${endpoint}/${config.bucket}/${objectKey}?${queryParams.toString()}`;
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}
