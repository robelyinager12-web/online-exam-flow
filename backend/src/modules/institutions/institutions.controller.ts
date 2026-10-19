import { actorFromRequest } from '../../lib/actor';
import { asyncHandler } from '../../lib/asyncHandler';
import { requestContext } from '../../lib/http';
import * as service from './institutions.service';

export const list = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const { items, meta } = await service.listInstitutions(actor, req.query as never);
  res.status(200).json({ success: true, data: items, meta });
});

export const create = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const { institution, admin } = await service.createInstitution(actor, req.body, requestContext(req));
  res.status(201).json({ success: true, data: { institution, admin } });
});

export const current = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const institution = await service.getCurrentInstitution(actor);
  res.status(200).json({ success: true, data: { institution } });
});

export const get = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const institution = await service.getInstitution(actor, req.params.id);
  res.status(200).json({ success: true, data: { institution } });
});

export const update = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const institution = await service.updateInstitution(actor, req.params.id, req.body, requestContext(req));
  res.status(200).json({ success: true, data: { institution } });
});

export const getSettings = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const settings = await service.getSettings(actor, req.params.id);
  res.status(200).json({ success: true, data: { settings } });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const settings = await service.updateSettings(actor, req.params.id, req.body, requestContext(req));
  res.status(200).json({ success: true, data: { settings } });
});