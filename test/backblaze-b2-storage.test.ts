import { createHash } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalEnv = { ...process.env };

describe('Backblaze B2 native storage provider', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {
      ...originalEnv,
      BACKBLAZE_B2_APPLICATION_KEY: 'application-key',
      BACKBLAZE_B2_BUCKET_NAME: 'the-blazer',
      BACKBLAZE_B2_KEY_ID: 'key-id',
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it('retries upload with a fresh upload URL when Backblaze rejects the first upload token', async () => {
    const mediaBytes = new TextEncoder().encode('generated image bytes');
    const uploadBodies: Uint8Array[] = [];
    const uploadHeaders: Record<string, string>[] = [];
    const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const requestUrl = String(url);

      if (requestUrl.endsWith('/b2_authorize_account')) {
        return jsonResponse({
          accountId: 'account-id',
          allowed: { bucketId: 'bucket-id', bucketName: 'the-blazer' },
          apiUrl: 'https://api005.backblazeb2.com',
          authorizationToken: 'account-token',
          downloadUrl: 'https://f005.backblazeb2.com',
        });
      }

      if (requestUrl.endsWith('/b2_get_upload_url')) {
        const requestNumber = fetchMock.mock.calls.filter(([callUrl]) =>
          String(callUrl).endsWith('/b2_get_upload_url'),
        ).length;

        return jsonResponse({
          authorizationToken: `upload-token-${requestNumber}`,
          uploadUrl: `https://pod.example.com/upload-${requestNumber}`,
        });
      }

      if (requestUrl === 'https://pod.example.com/upload-1') {
        uploadBodies.push(toBytes(init?.body));
        uploadHeaders.push(toHeaderRecord(init?.headers));

        return jsonResponse(
          { code: 'expired_auth_token', message: 'Upload token expired.' },
          { status: 401 },
        );
      }

      if (requestUrl === 'https://pod.example.com/upload-2') {
        uploadBodies.push(toBytes(init?.body));
        uploadHeaders.push(toHeaderRecord(init?.headers));

        return jsonResponse({
          fileName: 'user 1/generation+日本語.png',
        });
      }

      throw new Error(`Unexpected fetch URL: ${requestUrl}`);
    });

    vi.stubGlobal('fetch', fetchMock);

    const { createBackblazeB2StorageProvider } =
      await import('@/lib/storage/backblaze-b2/server-actions');
    const provider = createBackblazeB2StorageProvider();

    await expect(
      provider.store({
        contentType: 'image/png',
        data: mediaBytes,
        key: 'user 1/generation+日本語.png',
      }),
    ).resolves.toEqual({
      publicUrl: null,
      storagePath: 'user 1/generation+日本語.png',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api005.backblazeb2.com/b2api/v3/b2_get_upload_url',
      expect.objectContaining({
        body: JSON.stringify({ bucketId: 'bucket-id' }),
        method: 'POST',
      }),
    );
    expect(uploadBodies.map((body) => Array.from(body))).toEqual([
      Array.from(mediaBytes),
      Array.from(mediaBytes),
    ]);
    expect(uploadHeaders[1]).toMatchObject({
      Authorization: 'upload-token-2',
      'Content-Length': String(mediaBytes.byteLength),
      'Content-Type': 'image/png',
      'X-Bz-Content-Sha1': createHash('sha1').update(mediaBytes).digest('hex'),
      'X-Bz-File-Name': 'user%201/generation%2B%E6%97%A5%E6%9C%AC%E8%AA%9E.png',
    });
  });
});

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: init?.status ?? 200,
  });
}

function toBytes(body: BodyInit | null | undefined) {
  if (body instanceof Uint8Array) {
    return body;
  }

  throw new Error('Expected Uint8Array request body.');
}

function toHeaderRecord(headers: HeadersInit | undefined) {
  if (!headers || Array.isArray(headers) || headers instanceof Headers) {
    throw new Error('Expected plain object request headers.');
  }

  return headers as Record<string, string>;
}
