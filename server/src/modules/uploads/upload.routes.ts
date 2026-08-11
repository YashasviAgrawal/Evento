import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { authenticate, requireOrganizer } from '../../middleware/auth';
import { uploadLimiter } from '../../middleware/rateLimit';
import { asyncHandler, ok } from '../../utils/http';
import { BadRequestError } from '../../utils/errors';

/**
 * Image uploads for event banners, galleries and organizer logos.
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

const uploadDir = path.isAbsolute(env.storage.uploadDir)
  ? env.storage.uploadDir
  : path.resolve(process.cwd(), env.storage.uploadDir);

fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
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
function looksLikeImage(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const riff = buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  const avif = buffer.subarray(4, 8).toString('ascii') === 'ftyp';
  return jpeg || png || riff || avif;
}

const router = Router();

router.post(
  '/image',
  authenticate,
  requireOrganizer,
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw new BadRequestError('Attach an image in the "file" field', 'NO_FILE');
    if (!looksLikeImage(file.buffer)) {
      throw new BadRequestError('That file is not a valid image', 'INVALID_IMAGE');
    }

    const folder = typeof req.body?.folder === 'string' && /^[a-z0-9-]{1,40}$/.test(req.body.folder)
      ? req.body.folder
      : 'events';

    if (env.storage.cloudinaryEnabled) {
      const result = await new Promise<{ secure_url: string; public_id: string; width: number; height: number }>(
        (resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: `evento/${folder}`, resource_type: 'image', overwrite: false },
            (error, uploaded) => {
              if (error || !uploaded) {
                reject(error ?? new Error('Cloudinary upload failed'));
                return;
              }
              resolve(uploaded as never);
            },
          );
          stream.end(file.buffer);
        },
      );

      return ok(res, {
        url: result.secure_url,
        publicId: result.public_id,
        width: result.width,
        height: result.height,
        provider: 'cloudinary',
      }, 201);
    }

    // Local fallback. The filename is generated, never taken from the client,
    // which removes any path-traversal surface.
    const extension = EXTENSION_BY_MIME[file.mimetype] ?? '.bin';
    const filename = `${folder}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`;
    const target = path.join(uploadDir, filename);
    await fs.promises.writeFile(target, file.buffer);
    logger.debug({ filename }, 'Stored upload on local disk (Cloudinary not configured)');

    return ok(res, {
      url: `${env.apiBaseUrl}/uploads/${filename}`,
      publicId: filename,
      provider: 'local',
    }, 201);
  }),
);

export default router;
export { uploadDir };
