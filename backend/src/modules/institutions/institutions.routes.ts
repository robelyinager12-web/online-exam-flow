import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as controller from './institutions.controller';
import { updateSettingsSchema } from './institutions.settings';
import {
  createInstitutionSchema,
  institutionIdParamSchema,
  listInstitutionsQuerySchema,
  updateInstitutionSchema,
} from './institutions.validation';

export const institutionsRouter = Router();

institutionsRouter.use(authenticate);

// Any signed-in user of an institution can see their own institution. Declared before "/:id".
institutionsRouter.get('/current', controller.current);

institutionsRouter.get('/', authorize('SUPER_ADMIN'), validate({ query: listInstitutionsQuerySchema }), controller.list);
institutionsRouter.post('/', authorize('SUPER_ADMIN'), validate({ body: createInstitutionSchema }), controller.create);

institutionsRouter.get(
  '/:id',
  authorize('SUPER_ADMIN', 'INSTITUTION_ADMIN'),
  validate({ params: institutionIdParamSchema }),
  controller.get,
);
institutionsRouter.patch(
  '/:id',
  authorize('SUPER_ADMIN', 'INSTITUTION_ADMIN'),
  validate({ params: institutionIdParamSchema, body: updateInstitutionSchema }),
  controller.update,
);

// Instructors may read the settings (the exam builder uses them as defaults) but not change them.
institutionsRouter.get(
  '/:id/settings',
  authorize('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'INSTRUCTOR'),
  validate({ params: institutionIdParamSchema }),
  controller.getSettings,
);
institutionsRouter.put(
  '/:id/settings',
  authorize('SUPER_ADMIN', 'INSTITUTION_ADMIN'),
  validate({ params: institutionIdParamSchema, body: updateSettingsSchema }),
  controller.updateSettings,
);