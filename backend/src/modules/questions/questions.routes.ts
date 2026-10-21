import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { authorize } from '../../middleware/authorize';
import { validate } from '../../middleware/validate';
import * as controller from './questions.controller';
import {
  createQuestionSchema,
  listQuestionsQuerySchema,
  listTagsQuerySchema,
  questionIdParamSchema,
  questionVersionParamSchema,
  updateQuestionSchema,
} from './questions.validation';

export const questionsRouter = Router();

// The question bank (with its answers) is for staff only. Students never reach it.
questionsRouter.use(authenticate, authorize('SUPER_ADMIN', 'INSTITUTION_ADMIN', 'INSTRUCTOR'));

// Declared before "/:id" so "tags" is never read as an id.
questionsRouter.get('/tags', validate({ query: listTagsQuerySchema }), controller.listTags);

questionsRouter.get('/', validate({ query: listQuestionsQuerySchema }), controller.list);
questionsRouter.post('/', validate({ body: createQuestionSchema }), controller.create);

questionsRouter.get('/:id', validate({ params: questionIdParamSchema }), controller.get);
questionsRouter.patch(
  '/:id',
  validate({ params: questionIdParamSchema, body: updateQuestionSchema }),
  controller.update,
);
questionsRouter.delete('/:id', validate({ params: questionIdParamSchema }), controller.remove);

questionsRouter.get('/:id/versions', validate({ params: questionIdParamSchema }), controller.listVersions);
questionsRouter.get('/:id/versions/:version', validate({ params: questionVersionParamSchema }), controller.getVersion);