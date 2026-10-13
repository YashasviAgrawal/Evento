import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Response } from 'express';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { query, queryOne } from '../../db/pool';
import { BadRequestError, NotFoundError, ServiceUnavailableError } from '../../utils/errors';

/**
 * KYC document storage — the PAN card and GST certificate an organizer uploads.
 *
 * Unlike event banners these are identity documents, so nothing here produces
 * a public URL. In Cloudinary they are `private` raw assets: the plain delivery
 * URL returns 401, and the API fetches the bytes through a signed download link
 * that expires in a minute. Without Cloudinary they go to a local directory that
 * is deliberately *not* the statically served uploads folder.
 */

export type KycDocumentKind = 'pan' | 'gst';

export const KYC_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

/** Single-file, in-memory parser for document uploads; nothing touches disk unchecked. */
export const kycDocumentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: KYC_DOCUMENT_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new BadRequestError('Upload a JPG, PNG, WebP image or a PDF', 'UNSUPPORTED_MEDIA_TYPE'));
      return;
    }
    cb(null, true);
  },
});

/** Stream a document back without letting any cache keep a copy. */
export function sendKycDocument(res: Response, document: { mimeType: string; buffer: Buffer }): void {
  res.setHeader('Content-Type', document.mimeType);
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(document.buffer);
}

/** The declared type is client-controlled; the file signature is what counts. */
function sniffMime(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

const uploadRoot = path.isAbsolute(env.storage.uploadDir)
  ? env.storage.uploadDir
  : path.resolve(process.cwd(), env.storage.uploadDir);
/** A sibling of the public uploads folder, never inside it. */
const privateDir = path.join(path.dirname(uploadRoot), 'kyc-private');

if (env.storage.cloudinaryEnabled) {
  cloudinary.config({
    cloud_name: env.storage.cloudName,
    api_key: env.storage.apiKey,
    api_secret: env.storage.apiSecret,
    secure: true,
  });
}

export interface KycDocument {
  id: string;
  kind: KycDocumentKind;
  mimeType: string;
  sizeBytes: number;
  originalName: string | null;
  uploadedAt: Date;
}

function mapDocument(row: Record<string, unknown>): KycDocument {
  return {
    id: row.id as string,
    kind: row.kind as KycDocumentKind,
    mimeType: row.mime_type as string,
    sizeBytes: Number(row.size_bytes),
    originalName: (row.original_name as string | null) ?? null,
    uploadedAt: row.uploaded_at as Date,
  };
}

async function storeInCloudinary(buffer: Buffer): Promise<string> {
  const uploaded = await new Promise<{ public_id: string }>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream({ folder: 'tixit/kyc', resource_type: 'raw', type: 'private' }, (error, result) => {
        if (error || !result) reject(new Error(error?.message ?? 'Cloudinary upload failed'));
        else resolve(result as never);
      })
      .end(buffer);
  });
  return uploaded.public_id;
}

async function storeLocally(buffer: Buffer, mime: string): Promise<string> {
  await fs.promises.mkdir(privateDir, { recursive: true });
  const filename = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${EXTENSION_BY_MIME[mime] ?? ''}`;
  await fs.promises.writeFile(path.join(privateDir, filename), buffer);
  return filename;
}

export async function uploadKycDocument(
  organizerId: string,
  kind: KycDocumentKind,
  file: { buffer: Buffer; originalname?: string },
): Promise<KycDocument> {
  const mime = sniffMime(file.buffer);
  if (!mime || !ALLOWED_MIME.has(mime)) {
    throw new BadRequestError('Upload a JPG, PNG, WebP image or a PDF', 'INVALID_DOCUMENT');
  }

  let storage: 'cloudinary' | 'local' = 'local';
  let key: string;
  if (env.storage.cloudinaryEnabled) {
    try {
      key = await storeInCloudinary(file.buffer);
      storage = 'cloudinary';
    } catch (error) {
      logger.error({ err: error }, 'KYC document upload to Cloudinary failed');
      // Local disk is not durable on most hosts, so production fails loudly
      // instead of keeping an identity document somewhere it may vanish from.
      if (env.isProd) throw new ServiceUnavailableError('Could not store the document, please try again', 'UPLOAD_PROVIDER_ERROR');
      key = await storeLocally(file.buffer, mime);
    }
  } else {
    key = await storeLocally(file.buffer, mime);
  }

  const row = await queryOne(
    `INSERT INTO kyc_documents (organizer_id, kind, storage, storage_key, mime_type, size_bytes, original_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [organizerId, kind, storage, key, mime, file.buffer.length, file.originalname?.slice(0, 200) ?? null],
  );
  return mapDocument(row!);
}

/** Documents by id, for attaching to a KYC submission or showing in a review. */
export async function getDocuments(ids: Array<string | null | undefined>): Promise<Map<string, KycDocument>> {
  const wanted = ids.filter((id): id is string => Boolean(id));
  if (wanted.length === 0) return new Map();
  const { rows } = await query('SELECT * FROM kyc_documents WHERE id = ANY($1::uuid[])', [wanted]);
  return new Map(rows.map((row) => [row.id as string, mapDocument(row)]));
}

/**
 * The bytes of one document. `organizerId` scopes the lookup for organizers;
 * admins pass null to read any organizer's document.
 */
export async function readKycDocument(
  documentId: string,
  organizerId: string | null,
): Promise<{ mimeType: string; buffer: Buffer }> {
  const row = await queryOne<{ storage: string; storage_key: string; mime_type: string; organizer_id: string }>(
    'SELECT storage, storage_key, mime_type, organizer_id FROM kyc_documents WHERE id = $1',
    [documentId],
  );
  if (!row || (organizerId !== null && row.organizer_id !== organizerId)) throw new NotFoundError('Document');

  if (row.storage === 'cloudinary') {
    const url = cloudinary.utils.private_download_url(row.storage_key, '', {
      resource_type: 'raw',
      type: 'private',
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });
    const response = await fetch(url);
    if (!response.ok) {
      logger.error({ status: response.status, documentId }, 'Could not fetch KYC document from Cloudinary');
      throw new ServiceUnavailableError('Could not load the document right now', 'DOCUMENT_UNAVAILABLE');
    }
    return { mimeType: row.mime_type, buffer: Buffer.from(await response.arrayBuffer()) };
  }

  // The key is generated server-side, but resolve it defensively anyway.
  const target = path.resolve(privateDir, row.storage_key);
  if (!target.startsWith(privateDir + path.sep)) throw new NotFoundError('Document');
  try {
    return { mimeType: row.mime_type, buffer: await fs.promises.readFile(target) };
  } catch {
    throw new NotFoundError('Document');
  }
}
