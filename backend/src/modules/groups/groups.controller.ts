import { actorFromRequest } from '../../lib/actor';
import { asyncHandler } from '../../lib/asyncHandler';
import { requestContext } from '../../lib/http';
import * as service from './groups.service';

export const list = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const { items, meta } = await service.listGroups(actor, req.query as never);
  res.status(200).json({ success: true, data: items, meta });
});

export const create = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const group = await service.createGroup(actor, req.body, requestContext(req));
  res.status(201).json({ success: true, data: { group } });
});

export const get = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const group = await service.getGroup(actor, req.params.id);
  res.status(200).json({ success: true, data: { group } });
});

export const update = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const group = await service.updateGroup(actor, req.params.id, req.body, requestContext(req));
  res.status(200).json({ success: true, data: { group } });
});

export const remove = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  await service.deleteGroup(actor, req.params.id, requestContext(req));
  res.status(200).json({ success: true, data: { message: 'Group deleted' } });
});

export const listMembers = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const { items, meta } = await service.listMembers(actor, req.params.id, req.query as never);
  res.status(200).json({ success: true, data: items, meta });
});

export const addMembers = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const result = await service.addMembers(actor, req.params.id, req.body, requestContext(req));
  res.status(200).json({ success: true, data: result });
});

export const removeMember = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  await service.removeMember(actor, req.params.id, req.params.userId, requestContext(req));
  res.status(200).json({ success: true, data: { message: 'Member removed from the group' } });
});