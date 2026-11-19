import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { BadRequestError, ServiceUnavailableError } from '../utils/errors';

/**
 * Image storage for every product surface — event banners, organizer logos,
 * restaurant menus, diner photos.
 *
 * Cloudinary is used when configured; otherwise files are written to a local
 * directory and served statically, so the product is fully usable in local
 * development without a cloud account.
 */

if (env.storage.cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.storage.cloudName,
    api_key: env.storage.apiKey,
    api_secret: env.storage.apiSecret,
    secure: true,
  });
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

export const uploadDir = path.isAbsolute(env.storage.uploadDir)
  ? env.storage.uploadDir
  : path.resolve(process.cwd(), env.storage.uploadDir);

fs.mkdirSync(uploadDir, { recursive: true });

/** Multer for one image in the `file` field; nothing touches disk until validated. */
export const imageUpload = multer({
  // Memory storage keeps the request in RAM until validation passes, so a
  // rejected file never lands on disk.
  storage: multer.memoryStorage(),
  limits: { fileSize: env.storage.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new BadRequestError('Only JPEG, PNG, WebP or AVIF images are allowed', 'UNSUPPORTED_MEDIA_TYPE'));
      return;
    }
    cb(null, true);
  },
});

/**
 * Magic-number check.
 *
 * A client controls the declared Content-Type, so trusting it alone would let
 * an attacker upload a script with `image/png` on the label. Reading the file
 * signature is what actually establishes the type.
 */
export function looksLikeImage(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const riff = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const avif = buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  return jpeg || png || riff || avif;
}

type CloudinaryResult = { secure_url: string; public_id: string; width: number; height: number };

/**
 * The Cloudinary SDK only parses response bodies for a known set of status
 * codes (200/400/401/404/420/500). Anything else — notably 403 — is collapsed
 * into an opaque `UnexpectedResponse` object that drops the provider's actual
 * message, and because it rejects with a plain object rather than an `Error`
 * the stack is lost too. This normalises whatever comes back into a real Error
 * carrying an actionable message.
 */
function normaliseCloudinaryError(error: unknown): Error & { httpCode?: number } {
  const raw = error as { message?: string; http_code?: number; name?: string } | undefined;
  const httpCode = typeof raw?.http_code === 'number' ? raw.http_code : undefined;

  let message = raw?.message ?? 'Cloudinary upload failed';
  if (httpCode === 401 || httpCode === 403) {
    // The SDK discards the body on 403, so spell out the cause the status
    // actually indicates: the credentials reached Cloudinary but the key is
    // not allowed to create assets.
    message =
      `${message} — Cloudinary rejected the upload as unauthorised. The API key is valid but its ` +
      'assigned role lacks the "create" / "Upload assets" permission. Assign the key a role that ' +
      'includes it (Master Admin, Admin, Tech Admin or Media Library Admin) in the Cloudinary ' +
      'console under Settings → API Keys.';
  }

  const normalised = Object.assign(new Error(message), { httpCode });
  normalised.name = raw?.name ?? 'CloudinaryError';
  return normalised;
}

function uploadToCloudinary(buffer: Buffer, folder: string): Promise<CloudinaryResult> {
  return new Promise<CloudinaryResult>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: `tixit/${folder}`, resource_type: 'image', overwrite: false },
      (error, uploaded) => {
        if (error || !uploaded) {
          reject(normaliseCloudinaryError(error));
          return;
        }
        resolve(uploaded as never);
      },
    );
    stream.end(buffer);
  });
}

/**
 * Local fallback. The filename is generated, never taken from the client,
 * which removes any path-traversal surface.
 */
async function storeLocally(file: Express.Multer.File, folder: string) {
  const extension = EXTENSION_BY_MIME[file.mimetype] ?? '.bin';
  const filename = `${folder}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`;
  const target = path.join(uploadDir, filename);
  await fs.promises.writeFile(target, file.buffer);

  return {
    url: `${env.apiBaseUrl}/uploads/${filename}`,
    publicId: filename,
    provider: 'local' as const,
  };
}

export interface StoredImage {
  url: string;
  publicId: string;
  width?: number;
  height?: number;
  provider: 'cloudinary' | 'local';
}

/** Folder names are path segments, so they are validated, never passed through. */
export const FOLDER_PATTERN = /^[a-z0-9-]{1,40}$/;

/**
 * Validate an uploaded image by its bytes and store it. Outside production a
 * Cloudinary failure falls back to local disk, so a provider problem never
 * blocks someone mid-session.
 */
export async function storeImage(file: Express.Multer.File | undefined, folder: string): Promise<StoredImage> {
  if (!file) throw new BadRequestError('Attach an image in the "file" field', 'NO_FILE');
  if (!looksLikeImage(file.buffer)) throw new BadRequestError('That file is not a valid image', 'INVALID_IMAGE');
  if (!FOLDER_PATTERN.test(folder)) throw new BadRequestError('Invalid upload folder', 'INVALID_FOLDER');

  if (env.storage.cloudinaryEnabled) {
    try {
      const result = await uploadToCloudinary(file.buffer, folder);
      return { url: result.secure_url, publicId: result.public_id, width: result.width, height: result.height, provider: 'cloudinary' };
    } catch (error) {
      const failure = normaliseCloudinaryError(error);
      logger.error({ err: failure, httpCode: failure.httpCode, folder }, 'Cloudinary upload failed');
      if (!env.isProd) {
        const local = await storeLocally(file, folder);
        logger.warn({ filename: local.publicId }, 'Fell back to local disk after Cloudinary failure');
        return local;
      }
      throw new ServiceUnavailableError(failure.message, 'UPLOAD_PROVIDER_ERROR');
    }
  }

  const local = await storeLocally(file, folder);
  logger.debug({ filename: local.publicId }, 'Stored upload on local disk (Cloudinary not configured)');
  return local;
}

/**
 * Best-effort removal, used when a diner deletes a photo or a moderator
 * removes one. A failure is logged, not thrown: the database row is the source
 * of truth for what is shown.
 */
export async function deleteImage(image: { publicId: string; provider: 'cloudinary' | 'local' }): Promise<void> {
  try {
    if (image.provider === 'cloudinary') {
      if (env.storage.cloudinaryEnabled) await cloudinary.uploader.destroy(image.publicId);
      return;
    }
    if (!/^[a-z0-9-]+-\d+-[a-f0-9]{16}\.[a-z]+$/.test(image.publicId)) return;
    await fs.promises.rm(path.join(uploadDir, image.publicId), { force: true });
  } catch (error) {
    logger.warn({ err: error, publicId: image.publicId }, 'Could not delete stored image');
  }
}
