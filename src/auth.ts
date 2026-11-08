export interface AuthEnv {
  LOCAL_DEV?: string;
  APP_ORIGIN: string;
}
export function isLocal(request: Request, env: AuthEnv) {
  const url = new URL(request.url);
  return (
    env.LOCAL_DEV === "true" &&
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(url.hostname)
  );
}
export async function sha256(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
