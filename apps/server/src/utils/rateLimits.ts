// Rate limits for signed-in actions are counted per person, not per
// address: a club at a show shares one Wi-Fi address, and one busy member
// must not use up everyone else's turns. Signed out, the address counts
// (sign-in, sign-up and the other public routes keep plain per-address
// limits). The count runs after sign-in is read (preHandler), so it knows
// who it is.

import type { FastifyRequest } from 'fastify';

/** Who a limit counts: the person, else (signed out) the address. */
export const personOrAddress = (req: FastifyRequest): string => req.user?.id ?? req.ip;

/** `max` requests per `timeWindow` ('1 minute', '1 hour'), per person. */
export function perPerson(max: number, timeWindow: string) {
  return { max, timeWindow, hook: 'preHandler' as const, keyGenerator: personOrAddress };
}
