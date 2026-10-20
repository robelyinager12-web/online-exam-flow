import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as controller from './groups.controller';
import {
  addMembersSchema,
  createGroupSchema,
  groupIdParamSchema,
  groupMemberParamSchema,
  listGroupsQuerySchema,
  listMembersQuerySchema,
  updateGroupSchema,
} from './groups.validation';

export const groupsRouter = Router();

groupsRouter.use(authenticate);

const canRead = authorize('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'INSTRUCTOR'); // instructors: groups of their own courses
const canManage = authorize('SUPER_ADMIN', 'INSTITUTION_ADMIN');

groupsRouter.get('/', canRead, validate({ query: listGroupsQuerySchema }), controller.list);
groupsRouter.post('/', canManage, validate({ body: createGroupSchema }), controller.create);

groupsRouter.get('/:id', canRead, validate({ params: groupIdParamSchema }), controller.get);
groupsRouter.patch('/:id', canManage, validate({ params: groupIdParamSchema, body: updateGroupSchema }), controller.update);
groupsRouter.delete('/:id', canManage, validate({ params: groupIdParamSchema }), controller.remove);

groupsRouter.get(
  '/:id/members',
  canRead,
  validate({ params: groupIdParamSchema, query: listMembersQuerySchema }),
  controller.listMembers,
);
groupsRouter.post(
  '/:id/members',
  canManage,
  validate({ params: groupIdParamSchema, body: addMembersSchema }),
  controller.addMembers,
);
groupsRouter.delete(
  '/:id/members/:userId',
  canManage,
  validate({ params: groupMemberParamSchema }),
  controller.removeMember,
);