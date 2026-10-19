import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as controller from './courses.controller';
import {
  assignInstructorsSchema,
  courseIdParamSchema,
  courseInstructorParamSchema,
  createCourseSchema,
  listCoursesQuerySchema,
  updateCourseSchema,
} from './courses.validation';

export const coursesRouter = Router();

coursesRouter.use(authenticate);

const canRead = authorize('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'INSTRUCTOR'); // instructors: their own courses only
const canManage = authorize('SUPER_ADMIN', 'INSTITUTION_ADMIN');

coursesRouter.get('/', canRead, validate({ query: listCoursesQuerySchema }), controller.list);
coursesRouter.post('/', canManage, validate({ body: createCourseSchema }), controller.create);

coursesRouter.get('/:id', canRead, validate({ params: courseIdParamSchema }), controller.get);
coursesRouter.patch('/:id', canManage, validate({ params: courseIdParamSchema, body: updateCourseSchema }), controller.update);
coursesRouter.delete('/:id', canManage, validate({ params: courseIdParamSchema }), controller.remove);

coursesRouter.get('/:id/instructors', canRead, validate({ params: courseIdParamSchema }), controller.listInstructors);
coursesRouter.post(
  '/:id/instructors',
  canManage,
  validate({ params: courseIdParamSchema, body: assignInstructorsSchema }),
  controller.addInstructors,
);
coursesRouter.delete(
  '/:id/instructors/:userId',
  canManage,
  validate({ params: courseInstructorParamSchema }),
  controller.removeInstructor,
);