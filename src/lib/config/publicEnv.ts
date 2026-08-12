/** Client-safe env values (NEXT_PUBLIC_*). */

const trim = (value: string | undefined): string => value?.trim() ?? "";

export const publicAuthEnv = {
  allowedEmailDomain: trim(process.env.NEXT_PUBLIC_AUTH_ALLOWED_EMAIL_DOMAIN) || "example.com",
};
