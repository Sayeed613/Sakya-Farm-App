import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';

/**
 * Profile photos, stored in the existing Postgres database.
 *
 * Chosen deliberately for this launch: no new infrastructure, automatic
 * backups with the rest of the data, and access control via the same API
 * that guards everything else. The table keeps the bytes as `bytea`; the
 * user row keeps a stable public URL (`/users/me/avatar?v=<hash>`) whose
 * version parameter changes with every upload so clients' image caches
 * invalidate themselves.
 *
 * Sizing: photos arrive already resized on the client (max 1024px, JPEG ~≤300
 * KB). The service still re-validates every limit so a hostile client cannot
 * use the endpoint as a database dump.
 */
const MAX_AVATAR_BYTES = 400 * 1024;
const ALLOWED_PREFIXES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Detect the real type from the magic bytes, not from a client-supplied header. */
function sniffImageMime(bytes: Buffer): (typeof ALLOWED_PREFIXES)[number] | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length > 8 && bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return 'image/png';
  }
  if (
    bytes.length > 12 &&
    bytes.subarray(0, 4).equals(Buffer.from('RIFF')) &&
    bytes.subarray(8, 12).equals(Buffer.from('WEBP'))
  ) {
    return 'image/webp';
  }
  return null;
}

@Injectable()
export class AvatarService {
  constructor(private readonly prisma: PrismaService) {}

  /** Store new avatar bytes for the caller; returns the public URL to render. */
  async putAvatar(userId: string, bytes: Buffer, contentType: string | undefined): Promise<string> {
    if (bytes.length === 0) {
      throw new BadRequestException('No image data was received');
    }
    if (bytes.length > MAX_AVATAR_BYTES) {
      throw new BadRequestException('Image is too large — please choose a smaller photo (max 400 KB)');
    }
    const mime = sniffImageMime(bytes);
    if (mime === null) {
      throw new BadRequestException('Only JPEG, PNG or WebP images are supported');
    }
    if (contentType !== undefined && !ALLOWED_PREFIXES.some((prefix) => contentType.startsWith(prefix))) {
      throw new BadRequestException('Unsupported image type');
    }

    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
    const version = randomUUID().slice(0, 8);

    await this.prisma.$transaction(async (tx) => {
      await tx.userAvatar.deleteMany({ where: { userId } });
      await tx.userAvatar.create({
        data: { userId, bytes: new Uint8Array(bytes), contentType: mime, contentHash: hash },
      });
      await tx.user.update({
        where: { id: userId },
        data: { avatarUrl: `/users/me/avatar?v=${version}` },
      });
    }, { timeout: 20_000 });

    return `/users/me/avatar?v=${version}`;
  }

  /** The caller's avatar bytes, or null when they never uploaded one. */
  async getAvatar(userId: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const row = await this.prisma.userAvatar.findUnique({
      where: { userId },
      select: { bytes: true, contentType: true },
    });
    if (row === null) {
      throw new NotFoundException('No profile photo has been uploaded');
    }
    return { bytes: Buffer.from(row.bytes as unknown as Uint8Array), contentType: row.contentType };
  }

  /** Remove the photo (also clears the URL on the user row). */
  async deleteAvatar(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userAvatar.deleteMany({ where: { userId } });
      await tx.user.update({ where: { id: userId }, data: { avatarUrl: null } });
    });
  }
}
