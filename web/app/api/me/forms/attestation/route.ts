import { json, withAuth } from "@/lib/http";
import { getAttestationStatement } from "@/lib/uploaded-forms";

// GET /api/me/forms/attestation — the current licensing-attestation wording to
// show beside the upload checkbox. Server snapshots the authoritative value at
// confirm time; this is display-only (no system_config exposure).
export async function GET(req: Request): Promise<Response> {
  return (await withAuth(
    req,
    async (): Promise<Response> => {
      const statement = await getAttestationStatement();
      return json({ statement });
    },
    { allowedRoles: ["agent", "admin", "tc"] }
  )) as Response;
}
