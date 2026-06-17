import { timingSafeEqual } from "node:crypto";

/** Constant-time string compare to avoid leaking secret length via timing. */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}
