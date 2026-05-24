import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),

  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_AUDIENCE: z.string().min(1),

  AWS_REGION: z.string().default(""),
  S3_BUCKET: z.string().default(""),

  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),

  DOCUSIGN_INTEGRATION_KEY: z.string().default(""),
  DOCUSIGN_USER_ID: z.string().default(""),
  DOCUSIGN_ACCOUNT_ID: z.string().default(""),
  DOCUSIGN_PRIVATE_KEY: z.string().default(""),
  DOCUSIGN_BASE_URL: z.string().default(""),

  ARIVE_API_URL: z.string().default(""),
  ARIVE_API_KEY: z.string().default(""),
  ARIVE_CLIENT_ID: z.string().default(""),
  ARIVE_CLIENT_SECRET: z.string().default(""),
  ARIVE_WEBHOOK_URL: z.string().default(""),

  GOOGLE_OAUTH_CLIENT_ID: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(""),
  GOOGLE_OAUTH_REDIRECT_URL: z.string().default(""),

  MICROSOFT_OAUTH_CLIENT_ID: z.string().default(""),
  MICROSOFT_OAUTH_CLIENT_SECRET: z.string().default(""),
  MICROSOFT_OAUTH_REDIRECT_URL: z.string().default(""),
  MICROSOFT_OAUTH_TENANT: z.string().default("common"),

  RESEND_API_KEY: z.string().default(""),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) {
    cached = schema.parse(process.env);
  }
  return cached;
}
