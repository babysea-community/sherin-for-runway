import { describe, expect, it } from 'vitest';

import {
  cleanupInputFileUploads,
  createInputFileAssetUrls,
  type StoredInputFileAsset,
} from '@/app/dashboard/studio/_lib/input-file-uploads';

describe('input file upload assets', () => {
  it('resolves stored public input URLs from durable asset metadata', async () => {
    const asset: StoredInputFileAsset = {
      byteLength: 1234,
      contentType: 'image/png',
      publicUrl: 'https://storage.example.com/input.png',
      source: 'upload',
      storagePath:
        'user-upload/user-1/00000000-0000-4000-8000-000000000000/input-1.png',
      storageProvider: 'vercel-blob',
      url: 'https://storage.example.com/input.png',
    };

    await expect(createInputFileAssetUrls([asset])).resolves.toEqual([
      'https://storage.example.com/input.png',
    ]);
  });

  it('reports legacy Supabase input cleanup failures', async () => {
    const admin = {
      storage: {
        from: () => ({
          remove: async () => ({ error: new Error('cleanup failed') }),
        }),
      },
    } as unknown as Parameters<typeof cleanupInputFileUploads>[0];

    await expect(
      cleanupInputFileUploads(admin, 'user-1', [
        'user-upload/user-1/00000000-0000-4000-8000-000000000000/input-1.png',
      ]),
    ).resolves.toBe(false);
  });
});
