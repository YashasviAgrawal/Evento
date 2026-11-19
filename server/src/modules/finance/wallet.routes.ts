import { Router } from 'express';
import { authenticate, currentUser } from '../../middleware/auth';
import { asyncHandler, ok } from '../../utils/http';
import { walletSummary } from './wallet';

/** The Tixit Wallet belongs to the account, so it is not under /dining. */
const router = Router();
router.use(authenticate);
router.get('/', asyncHandler(async (req, res) => ok(res, await walletSummary(currentUser(req).id))));

export default router;
