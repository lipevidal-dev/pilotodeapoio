import { createHmac, timingSafeEqual } from "node:crypto";
import type { UserRole } from "@prisma/client";

const SECRET = process.env.JWT_SECRET ?? "piloto-dev-secret-change-in-prod";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  exp: number;
}

export function createAuthToken(
  payload: Omit<AuthTokenPayload, "exp">,
  ttlSeconds = 60 * 60 * 24,
): string {
  const full: AuthTokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const data = Buffer.from(JSON.stringify(full)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", SECRET).update(data).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString()) as AuthTokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
