import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";
import { AUTH_CONFIG } from "./config";

const SECRET = AUTH_CONFIG.SECRET_KEY;

interface Session {
  authenticated: true;
  createdAt: number;
}

export async function createSession(): Promise<string> {
  const now = Date.now();
  const token = await new SignJWT({ authenticated: true, createdAt: now })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(AUTH_CONFIG.TOKEN_EXPIRY)
    .sign(SECRET);

  return token;
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const verified = await jwtVerify(token, SECRET);
    const payload = verified.payload as unknown;
    if (payload && typeof payload === "object" && "authenticated" in payload) {
      return payload as Session;
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth_token")?.value;

  if (!token) {
    return null;
  }

  return verifySession(token);
}

export async function setSessionCookie(token: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("auth_token", token, AUTH_CONFIG.COOKIE_CONFIG);
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete("auth_token");
}

export function validatePassword(password: string): boolean {
  const appPassword = process.env.APP_PASSWORD;
  if (!appPassword) {
    console.warn("APP_PASSWORD is not configured.");
    return false;
  }
  return password === appPassword;
}
