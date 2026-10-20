import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import * as controller from './me.controller';

// "What is mine": the signed-in person's own groups and courses.
export const meRouter = Router();

meRouter.use(authenticate);

meRouter.get('/groups', authorize('STUDENT'), controller.groups);
meRouter.get('/courses', authorize('STUDENT', 'INSTRUCTOR'), controller.courses);