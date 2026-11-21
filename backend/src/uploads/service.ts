import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AppPgDatabase } from '../db/client.js';
import { uploads } from '../db/schema.js';

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

/** 1 MB per image: the whole issue must stay under 1 MB of images (NWS-09). */
export const MAX_IMAGE_BYTES = 1024 * 1024;

/** Detects the type from the file's first bytes, never from its name or the declared type. */
export function imageType(bytes: Buffer): string | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a') return 'image/gif';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/** Newsletter images (NWS-05), stored in Postgres and served from the public API. */
export class UploadService {
  constructor(
    private readonly db: AppPgDatabase,
    private readonly publicApiUrl: string,
  ) {}

  url(id: string) {
    return `${this.publicApiUrl}/api/public/images/${id}`;
  }

  async saveImage(bytes: Buffer, actorId: string): Promise<{ id: string; url: string; size: number; contentType: string }> {
    if (bytes.length > MAX_IMAGE_BYTES) throw new UploadError('Images can be at most 1 MB; compress it first');
    const contentType = imageType(bytes);
    if (!contentType) throw new UploadError('Upload a PNG, JPEG, GIF or WebP image');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const [row] = await this.db
      .insert(uploads)
      .values({ contentType, bytes: bytes.toString('base64'), size: bytes.length, sha256, uploadedBy: actorId })
      .returning({ id: uploads.id });
    const id = (row as { id: string }).id;
    return { id, url: this.url(id), size: bytes.length, contentType };
  }

  async get(id: string): Promise<{ contentType: string; bytes: Buffer; sha256: string } | null> {
    const [row] = await this.db.select().from(uploads).where(eq(uploads.id, id));
    return row ? { contentType: row.contentType, bytes: Buffer.from(row.bytes, 'base64'), sha256: row.sha256 } : null;
  }

  /** Size of an uploaded image from its public URL; null for images hosted elsewhere. */
  async sizeOf(url: string): Promise<number | null> {
    const match = url.match(/\/api\/public\/images\/([0-9a-f-]{36})$/);
    if (!match || !url.startsWith(this.publicApiUrl)) return null;
    const [row] = await this.db.select({ size: uploads.size }).from(uploads).where(eq(uploads.id, match[1] as string));
    return row?.size ?? null;
  }
}
