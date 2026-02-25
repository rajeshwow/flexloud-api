import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env";

const jwksUrl = new URL(`${env.JWT_ISSUER}/.well-known/jwks.json`);
const JWKS = createRemoteJWKSet(jwksUrl);

export async function verifyIdToken(token: string) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
  return payload;
}
