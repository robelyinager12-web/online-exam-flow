import { actorFromRequest } from '../../lib/actor';
import { asyncHandler } from '../../lib/asyncHandler';
import { requestContext } from '../../lib/http';
import * as service from './questions.service';

export const list = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const { items, meta } = await service.listQuestions(actor, req.query as never);
  res.status(200).json({ success: true, data: items, meta });
});

export const create = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const question = await service.createQuestion(actor, req.body, requestContext(req));
  res.status(201).json({ success: true, data: { question } });
});

export const get = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const question = await service.getQuestion(actor, req.params.id);
  res.status(200).json({ success: true, data: { question } });
});

export const update = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const question = await service.updateQuestion(actor, req.params.id, req.body, requestContext(req));
  res.status(200).json({ success: true, data: { question } });
});

export const remove = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  await service.deleteQuestion(actor, req.params.id, requestContext(req));
  res.status(200).json({ success: true, data: { message: 'Question deleted' } });
});

export const listVersions = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const versions = await service.listVersions(actor, req.params.id);
  res.status(200).json({ success: true, data: versions });
});

export const getVersion = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const version = await service.getVersion(actor, req.params.id, Number(req.params.version));
  res.status(200).json({ success: true, data: { version } });
});

export const listTags = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const tags = await service.listTags(actor, req.query as never);
  res.status(200).json({ success: true, data: tags });
});