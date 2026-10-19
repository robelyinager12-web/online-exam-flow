import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { csvUpload } from '../../middleware/upload';
import { validate } from '../../middleware/validate';
import * as controller from './users.controller';
import {
  createUserSchema,
  idParamSchema,
  importQuerySchema,
  listUsersQuerySchema,
  updateUserSchema,
} from './users.validation';

export const usersRouter = Router();

// User management is for administrators only. The controller re-checks the database on every call.
usersRouter.use(authenticate, authorize('SUPER_ADMIN', 'INSTITUTION_ADMIN'));

usersRouter.get('/', validate({ query: listUsersQuerySchema }), controller.list);
usersRouter.post('/', validate({ body: createUserSchema }), controller.create);

// Declared before "/:id" so "import" is never read as an id.
usersRouter.post('/import', csvUpload, validate({ query: importQuerySchema }), controller.importCsv);

usersRouter.get('/:id', validate({ params: idParamSchema }), controller.get);
usersRouter.patch('/:id', validate({ params: idParamSchema, body: updateUserSchema }), controller.update);
usersRouter.delete('/:id', validate({ params: idParamSchema }), controller.remove);
usersRouter.post('/:id/deactivate', validate({ params: idParamSchema }), controller.deactivate);
usersRouter.post('/:id/reactivate', validate({ params: idParamSchema }), controller.reactivate);
usersRouter.post('/:id/resend-invite', validate({ params: idParamSchema }), controller.resendInvite);