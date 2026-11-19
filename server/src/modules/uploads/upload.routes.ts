import { Router } from 'express';
import { authenticate, requireOrganizer } from '../../middleware/auth';
import { uploadLimiter } from '../../middleware/rateLimit';
import { imageUpload, storeImage, FOLDER_PATTERN } from '../../services/storage.service';
import { asyncHandler, ok } from '../../utils/http';

/** Image uploads for event banners, galleries and organizer logos. */
const router = Router();

router.post(
  '/image',
  authenticate,
  requireOrganizer,
  uploadLimiter,
  imageUpload.single('file'),
  asyncHandler(async (req, res) => {
    const folder = typeof req.body?.folder === 'string' && FOLDER_PATTERN.test(req.body.folder) ? req.body.folder : 'events';
    return ok(res, await storeImage(req.file, folder), 201);
  }),
);

export default router;
export { uploadDir } from '../../services/storage.service';
