import { actorFromRequest } from '../../lib/actor';
import { asyncHandler } from '../../lib/asyncHandler';
import { requestContext } from '../../lib/http';
import * as service from './courses.service';

export const list = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const { items, meta } = await service.listCourses(actor, req.query as never);
  res.status(200).json({ success: true, data: items, meta });
});

export const create = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const course = await service.createCourse(actor, req.body, requestContext(req));
  res.status(201).json({ success: true, data: { course } });
});

export const get = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const course = await service.getCourse(actor, req.params.id);
  res.status(200).json({ success: true, data: { course } });
});

export const update = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const course = await service.updateCourse(actor, req.params.id, req.body, requestContext(req));
  res.status(200).json({ success: true, data: { course } });
});

export const remove = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  await service.deleteCourse(actor, req.params.id, requestContext(req));
  res.status(200).json({ success: true, data: { message: 'Course deleted' } });
});

export const listInstructors = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const instructors = await service.listInstructors(actor, req.params.id);
  res.status(200).json({ success: true, data: instructors });
});

export const addInstructors = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  const result = await service.addInstructors(actor, req.params.id, req.body.userIds, requestContext(req));
  res.status(200).json({ success: true, data: result });
});

export const removeInstructor = asyncHandler(async (req, res) => {
  const actor = await actorFromRequest(req);
  await service.removeInstructor(actor, req.params.id, req.params.userId, requestContext(req));
  res.status(200).json({ success: true, data: { message: 'Instructor removed from the course' } });
});