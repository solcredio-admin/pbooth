import type { FastifyRequest } from "fastify";

import type { Role } from "../auth/roles.js";

export interface AuthedAdmin { id: string; username: string; role: Role; sessionId: string }
export type Req = FastifyRequest & { admin?: AuthedAdmin };

export const clientMeta = (req: FastifyRequest) => ({
  ip: req.ip,
  userAgent: req.headers["user-agent"]?.slice(0, 300),
});
