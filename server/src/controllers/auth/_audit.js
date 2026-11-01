/**
 * Thin re-export so the controller can call audit() without a long path.
 * Keeps AUDIT_ACTIONS naming local & readable.
 */
import { audit } from '../../middlewares/audit.js';
import { AUDIT_ACTIONS } from '../../config/constants.js';

export { audit, AUDIT_ACTIONS as AUDIT_ACTIONS_LOCAL };
