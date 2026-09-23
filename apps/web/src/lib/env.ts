export const env = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  authSecret: process.env.AUTH_SECRET ?? "dev-secret-change-me",
  workosApiKey: process.env.WORKOS_API_KEY,
  workosClientId: process.env.WORKOS_CLIENT_ID,
  postmarkToken: process.env.POSTMARK_SERVER_TOKEN,
  emailFrom: process.env.EMAIL_FROM ?? "no-reply@example.com",
  productName: process.env.PRODUCT_NAME ?? "Associate Reps",
  isProd: process.env.NODE_ENV === "production",
};
