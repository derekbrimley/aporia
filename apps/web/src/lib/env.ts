const isProd = process.env.NODE_ENV === "production";

// Session and magic-link tokens are HMAC'd with this; a known default would let anyone forge lookups.
// Checked lazily so `next build` (which also runs with NODE_ENV=production) doesn't need the secret.
function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if (isProd) throw new Error("AUTH_SECRET must be set to at least 32 characters in production");
  return s ?? "dev-secret-change-me";
}

export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  get authSecret() {
    return authSecret();
  },
  workosApiKey: process.env.WORKOS_API_KEY,
  workosClientId: process.env.WORKOS_CLIENT_ID,
  postmarkToken: process.env.POSTMARK_SERVER_TOKEN,
  emailFrom: process.env.EMAIL_FROM ?? "no-reply@example.com",
  productName: process.env.PRODUCT_NAME ?? "Associate Reps",
  isProd,
};
