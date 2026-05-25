import { error, withAuth } from "@/lib/http";

// TODO(phase-8-followup): real Microsoft OAuth flow via @azure/msal-node.
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(req, async (): Promise<Response> =>
    error("microsoft calendar OAuth not yet implemented", 501)
  )) as Response;
}
