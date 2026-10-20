// One error handler for the whole server. Fastify's default sends the
// thrown error's message back to the caller, even on a 500, so a bug that
// throws ("body.title?.trim is not a function", a SQLite error, a file
// path from ENOENT) told the caller about the server's insides. Server
// errors now answer a plain { error: 'internal' } and the details go to
// the log only. Client errors (4xx: a body too large, bad JSON, a failed
// schema) still go to Fastify's own handler, whose message is about the
// request, not us.

import type { FastifyError, FastifyInstance } from 'fastify';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    const status = typeof err.statusCode === 'number' && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) {
      req.log.error({ err }, 'request failed');
      return reply.code(status).send({ error: 'internal' });
    }
    // Rethrowing hands the error to Fastify's own handler, unchanged.
    throw err;
  });
}
