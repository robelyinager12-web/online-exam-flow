import type { Request } from 'express';
import { AppError } from '../../lib/appError';
import { asyncHandler } from '../../lib/asyncHandler';
import type { RequestContext } from '../auth/auth.sessions';
import * as usersService from './users.service';

const context = (req: Request): RequestContext => ({
  ipAddress: req.ip,
  userAgent: req.get('user-agent') ?? undefined,
});

// Loads the acting admin from the database for every request (see loadActor).
async function actorOf(req: Request) {
  if (!req.user) {
    throw AppError.unauthorized();
  }
  return usersService.loadActor(req.user.id);
}

export const list = asyncHandler(async (req, res) => {
  const actor = await actorOf(req);
  const { items, meta } = await usersService.listUsers(actor, req.query as never);
  res.status(200).json({ success: true, data: items, meta });
});

export const create = asyncHandler(async (req, res) => {
  const actor = await actorOf(req);
  const user = await usersService.createUser(actor, req.body, context(req));
  res.status(201).json({ success: true, data: { user } });
});

export const get = asyncHandler(async (req, res) => {
  const actor = await actorOf(req);
  const user = await usersService.getUser(actor, req.params.id);
  res.status(200).json({ success: true, data: { user } });
});

export const update = asyncHandler(async (req, res) => {
  const actor = await actorOf(req);
  const user = await usersService.updateUser(actor, req.params.id, req.body, context(req));
  res.status(200).json({ success: true, data: { user } });
});

export const deactivate = asyncHandler(async (req, res) => {
  const actor = await actorOf(req);
  const user = await usersService.deactivateUser(actor, req.params.id, context(req));
  res.status(200).json({ success: true, data: { user } });
});

export const reactivate = asyncHandler(async (req, res) => {
  const actor = await actorOf(req);
  const user = await usersService.reactivateUser(actor, req.params.id, context(req));
  res.status(200).json({ success: true, data: { user } });
});

export const remove = asyncHandler(async (req, res) => {
  const actor = await actorOf(req);
  await usersService.deleteUser(actor, req.params.id, context(req));
  res.status(200).json({ success: true, data: { message: 'User deleted' } });
});

export const resendInvite = asyncHandler(async (req, res) => {
  const actor = await actorOf(req);
  await usersService.resendInvite(actor, req.params.id, context(req));
  res.status(200).json({ success: true, data: { message: 'Invitation sent' } });
});

export const importCsv = asyncHandler(async (req, res) => {
  const actor = await actorOf(req);
  if (!req.file) {
    throw AppError.badRequest('Attach a CSV file in the "file" field');
  }
  const report = await usersService.importUsers(actor, req.file.buffer, req.query as never, context(req));
  res.status(200).json({ success: true, data: report });
});