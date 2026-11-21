import type { FastifyRequest } from "fastify";

export interface AuthedAdmin { id: string; email: string; sessionId: string }
export type Req = FastifyRequest & { admin?: AuthedAdmin };

export const clientMeta = (req: FastifyRequest) => ({
  ip: req.ip,
  userAgent: req.headers["user-agent"]?.slice(0, 300),
});
