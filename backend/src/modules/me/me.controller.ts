import { actorFromRequest } from '../../lib/actor';
import { asyncHandler } from '../../lib/asyncHandler';
import * as service from './me.service';

export const groups = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const data = await service.myGroups(actor);
  res.status(200).json({ success: true, data });
});

export const courses = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const data = await service.myCourses(actor);
  res.status(200).json({ success: true, data });
});