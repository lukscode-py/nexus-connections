import crypto from "node:crypto";

export function createId(size = 18) {
  return crypto.randomBytes(size).toString("hex");
}

export function createToken(size = 32) {
  return crypto.randomBytes(size).toString("base64url");
}

export function hashValue(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}
