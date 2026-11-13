# Cloud Run deployment

This Terraform configuration creates a Cloud Run service, a dedicated runtime service account, narrowly scoped access to the existing `backend-secrets` Secret Manager secret, and required Google Cloud APIs. It uses an existing Supabase project for authentication and encrypted PostgreSQL storage. It does not create or apply Supabase migrations, create a secret version, build an image, configure a Terraform remote backend, or deploy automatically. No secrets should be put in Terraform variables or state. The Supabase **publishable/anon** key is public configuration; never use the service-role key.

Before using this for real users, address the release blockers in `docs/security/encrypted-chat-review.md`, including durable per-user AI quotas, independent security review and real device testing. The API's current rate limit is per process and is not shared across Cloud Run instances. Cloud Run and Secret Manager can incur charges. Review the plan and your organization’s billing and IAM policies before applying.

1. Configure an existing Google Cloud project with billing, an existing Artifact Registry repository, and Terraform credentials. Enable an appropriate remote state backend with locking and restricted access for team use; this directory defaults to local state. Review the project and region. Create an enabled version of `backend-secrets` containing dotenv-formatted backend settings using a secure workflow outside Terraform. Do not paste the key into code, state, shell history, or logs.
2. Apply the Drizzle migrations to a **staging** Supabase project first. Verify baseline adoption and backups as described in the root README. The `0001` migration requires `auth.users` and the Supabase `anon` and `authenticated` roles. It creates RLS policies and grants; it does not migrate previous SQLite files.
3. Build and push the image to an existing Artifact Registry repository, then obtain its immutable `@sha256:...` digest. For a normal environment run `docker build -t IMAGE .`; this repository uses a separate, locked server dependency manifest. If a corporate proxy requires a trusted CA, BuildKit can use a temporary secret: `docker build --secret id=npm_ca,src=/path/to/trusted-ca.pem -t IMAGE .`. The CA is not copied into the resulting image. Authenticate Docker to the registry through your organization’s approved method and push the image.
4. From this directory, run `terraform init`, provide `project_id`, `region`, `container_image`, `backend_secret_id` and `backend_secret_version` in a local `.tfvars` file, and run `terraform plan -out=tfplan`. Keep plan and state files private: Terraform state contains infrastructure configuration. Review the plan before `terraform apply tfplan`.
5. By default Google IAM blocks public invocation. The mobile application uses Supabase authentication rather than Google ID tokens, so enable `allow_public_invocation = true` only when ready to expose the endpoint. Every application route still verifies a Supabase access token. An organization policy can prohibit `allUsers`; address that policy through the approved ingress design instead of bypassing it. Use the output `service_url` as the HTTPS mobile API URL.

The container listens on Cloud Run's `PORT` and uses Supabase PostgREST with the caller’s JWT rather than a service-role credential. Cloud Run mounts the dotenv secret read-only; the backend reads it at startup. Restart or redeploy after changing the secret version. Logs should not include message content or tokens; proxy and provider logging/retention still need review. The service has deletion protection; disabling it and destroying the service requires a deliberate follow-up change.

## Backend secret format

Provision `backend-secrets` outside Terraform, with these entries in dotenv format. The Supabase key must be the publishable/anon key, never a service-role key. Enable a provider only by supplying both its API key and at least one verified model ID; the server exposes those IDs in the app and rejects all other choices. The example is a template, not a real secret:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_KEY
OPENAI_API_KEY=YOUR_OPENAI_KEY
OPENAI_MODELS=YOUR_OPENAI_MODEL_ID
ANTHROPIC_API_KEY=YOUR_ANTHROPIC_KEY
ANTHROPIC_MODELS=YOUR_ANTHROPIC_MODEL_ID
```

Separate multiple model IDs with commas. A user’s selected provider receives the conversation context for that request and may have its own processing and retention policy. Terraform defaults are project `alorun`, region `us-central1`, and secret ID `backend-secrets`; build and push the image to the existing `alorun` Artifact Registry repository and supply its actual digest. Secret values never need to appear in Terraform state.
