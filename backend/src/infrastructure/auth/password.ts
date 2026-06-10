import { createHash, timingSafeEqual } from "node:crypto";

export function hashPassword(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export function verifyPassword(plain: string, passwordHash: string): boolean {
  const candidate = hashPassword(plain);
  try {
    return timingSafeEqual(Buffer.from(candidate), Buffer.from(passwordHash));
  } catch {
    return false;
  }
}
