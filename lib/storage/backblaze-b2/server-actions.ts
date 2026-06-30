import 'server-only';

import { createHash } from 'node:crypto';

import { getOptionalEnv, requireEnv } from '@/lib/utils/env';
import type { StorageProvider, StoreInput, StoreResult } from '../types';

const B2_API_BASE_URL = 'https://api.backblazeb2.com';
const B2_API_VERSION = 'v3';
const AUTH_CACHE_TTL_MS = 23 * 60 * 60 * 1000;
const DOWNLOAD_AUTH_TTL_SECONDS = 60 * 60;

type BackblazeAuthorization = {
  accountId: string;
  allowed?: {
    bucketId?: string | null;
    bucketName?: string | null;
  };
  apiUrl: string;
  authorizationToken: string;
  downloadUrl: string;
};

type BackblazeBucket = {
  bucketId: string;
  bucketName: string;
};

type BackblazeUploadUrl = {
  authorizationToken: string;
  uploadUrl: string;
};

type BackblazeUploadResponse = {
  fileName: string;
};

type BackblazeDownloadAuthorization = {
  authorizationToken: string;
};

type BackblazeListBucketsResponse = {
  buckets?: BackblazeBucket[];
};

type BackblazeListFileVersionsResponse = {
  files?: Array<{
    fileId: string;
    fileName: string;
  }>;
  nextFileId?: string | null;
  nextFileName?: string | null;
};

let cachedAuthorization: {
  cacheKey: string;
  expiresAt: number;
  value: BackblazeAuthorization;
} | null = null;

let cachedBuckets = new Map<string, BackblazeBucket>();

export function isBackblazeB2StorageConfigured() {
  return Boolean(
    getOptionalEnv('BACKBLAZE_B2_KEY_ID') &&
    getOptionalEnv('BACKBLAZE_B2_APPLICATION_KEY') &&
    getOptionalEnv('BACKBLAZE_B2_BUCKET_NAME'),
  );
}

export function createBackblazeB2StorageProvider(): StorageProvider {
  const bucketName = requireEnv('BACKBLAZE_B2_BUCKET_NAME');

  return {
    id: 'backblaze-b2',
    label: `backblaze-b2 · ${bucketName}`,
    async store(payload: StoreInput): Promise<StoreResult> {
      const bucket = await resolveBucket(bucketName);
      const upload = await getUploadUrl(bucket.bucketId);
      const fileName = normalizeFileName(payload.key);
      const response = await fetch(upload.uploadUrl, {
        body: Buffer.from(payload.data),
        headers: {
          Authorization: upload.authorizationToken,
          'Content-Length': String(payload.data.byteLength),
          'Content-Type': payload.contentType,
          'X-Bz-Content-Sha1': sha1Hex(payload.data),
          'X-Bz-File-Name': encodeB2Path(fileName),
        },
        method: 'POST',
      });
      const uploaded = await readB2Json<BackblazeUploadResponse>(
        response,
        'b2_upload_file',
      );

      return {
        storagePath: uploaded.fileName || fileName,
        publicUrl: null,
      };
    },
    async remove(storagePaths: string[]) {
      if (storagePaths.length === 0) {
        return;
      }

      const bucket = await resolveBucket(bucketName);

      for (const storagePath of storagePaths) {
        await deleteFileVersions(
          bucket.bucketId,
          normalizeFileName(storagePath),
        );
      }
    },
    async signedUrl(storagePath: string) {
      return createAuthorizedDownloadUrl(
        bucketName,
        normalizeFileName(storagePath),
      );
    },
  };
}

async function authorizeAccount() {
  const keyId = requireEnv('BACKBLAZE_B2_KEY_ID');
  const applicationKey = requireEnv('BACKBLAZE_B2_APPLICATION_KEY');
  const cacheKey = `${keyId}:${applicationKey}`;

  if (
    cachedAuthorization?.cacheKey === cacheKey &&
    cachedAuthorization.expiresAt > Date.now()
  ) {
    return cachedAuthorization.value;
  }

  const response = await fetch(
    `${B2_API_BASE_URL}/b2api/${B2_API_VERSION}/b2_authorize_account`,
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${keyId}:${applicationKey}`).toString('base64')}`,
      },
    },
  );
  const authorization = await readB2Json<BackblazeAuthorization>(
    response,
    'b2_authorize_account',
  );

  cachedAuthorization = {
    cacheKey,
    expiresAt: Date.now() + AUTH_CACHE_TTL_MS,
    value: authorization,
  };
  cachedBuckets = new Map();

  return authorization;
}

async function resolveBucket(bucketName: string) {
  const explicitBucketId = getOptionalEnv('BACKBLAZE_B2_BUCKET_ID');
  const cacheKey = `${bucketName}:${explicitBucketId ?? ''}`;
  const cachedBucket = cachedBuckets.get(cacheKey);

  if (cachedBucket) {
    return cachedBucket;
  }

  const authorization = await authorizeAccount();

  if (explicitBucketId) {
    return cacheBucket(cacheKey, {
      bucketId: explicitBucketId,
      bucketName,
    });
  }

  if (
    authorization.allowed?.bucketName === bucketName &&
    authorization.allowed.bucketId
  ) {
    return cacheBucket(cacheKey, {
      bucketId: authorization.allowed.bucketId,
      bucketName,
    });
  }

  const response = await b2Api<BackblazeListBucketsResponse>(
    authorization,
    'b2_list_buckets',
    {
      accountId: authorization.accountId,
      bucketName,
    },
  );
  const bucket = response.buckets?.find(
    (candidate) => candidate.bucketName === bucketName,
  );

  if (!bucket) {
    throw new Error(`Backblaze B2 bucket not found: ${bucketName}`);
  }

  return cacheBucket(cacheKey, bucket);
}

function cacheBucket(cacheKey: string, bucket: BackblazeBucket) {
  cachedBuckets.set(cacheKey, bucket);

  return bucket;
}

async function getUploadUrl(bucketId: string) {
  const authorization = await authorizeAccount();

  return b2Api<BackblazeUploadUrl>(authorization, 'b2_get_upload_url', {
    bucketId,
  });
}

async function createAuthorizedDownloadUrl(
  bucketName: string,
  fileName: string,
) {
  const authorization = await authorizeAccount();
  const bucket = await resolveBucket(bucketName);
  const downloadAuthorization = await b2Api<BackblazeDownloadAuthorization>(
    authorization,
    'b2_get_download_authorization',
    {
      bucketId: bucket.bucketId,
      fileNamePrefix: fileName,
      validDurationInSeconds: DOWNLOAD_AUTH_TTL_SECONDS,
    },
  );

  return `${authorization.downloadUrl}/file/${encodeURIComponent(bucketName)}/${encodeB2Path(fileName)}?Authorization=${encodeURIComponent(downloadAuthorization.authorizationToken)}`;
}

async function deleteFileVersions(bucketId: string, fileName: string) {
  const authorization = await authorizeAccount();
  let nextFileName: string | null | undefined = fileName;
  let nextFileId: string | null | undefined;

  while (nextFileName) {
    const response: BackblazeListFileVersionsResponse = await b2Api(
      authorization,
      'b2_list_file_versions',
      {
        bucketId,
        maxFileCount: 100,
        prefix: fileName,
        startFileId: nextFileId ?? undefined,
        startFileName: nextFileName,
      },
    );
    const files = response.files ?? [];

    for (const file of files) {
      if (file.fileName !== fileName) {
        continue;
      }

      await b2Api(authorization, 'b2_delete_file_version', {
        fileId: file.fileId,
        fileName: file.fileName,
      });
    }

    if (!response.nextFileName || !response.nextFileName.startsWith(fileName)) {
      break;
    }

    nextFileName = response.nextFileName;
    nextFileId = response.nextFileId;
  }
}

async function b2Api<T>(
  authorization: BackblazeAuthorization,
  operation: string,
  body: Record<string, unknown>,
) {
  const response = await fetch(
    `${authorization.apiUrl}/b2api/${B2_API_VERSION}/${operation}`,
    {
      body: JSON.stringify(body),
      headers: {
        Authorization: authorization.authorizationToken,
        'Content-Type': 'application/json',
      },
      method: 'POST',
    },
  );

  return readB2Json<T>(response, operation);
}

async function readB2Json<T>(response: Response, operation: string) {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Backblaze B2 ${operation} failed (${response.status}): ${text || response.statusText}`,
    );
  }

  return (text ? JSON.parse(text) : {}) as T;
}

function normalizeFileName(value: string) {
  const fileName = value.replace(/^\/+/, '');

  if (!fileName || fileName.includes('\0')) {
    throw new Error('Backblaze B2 storage path is invalid.');
  }

  return fileName;
}

function encodeB2Path(fileName: string) {
  return fileName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function sha1Hex(data: Uint8Array) {
  return createHash('sha1').update(data).digest('hex');
}
