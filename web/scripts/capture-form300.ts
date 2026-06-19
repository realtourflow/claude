/**
 * One-time seed capture for FORM 300. Reads the hand-built Envelope Template via
 * the DocuSign API — every tab's type, Data Label, page, position, and signer
 * role — converts DocuSign top-left coords to PDF bottom-left (the known_forms /
 * extract.ts frame), and writes scripts/form-300-known.json (the seed answer
 * key). Also checks whether the underlying PDF is fillable (AcroForm) or flat —
 * which decides how a future upload can be RECOGNIZED.
 *
 * Run from web/:  npx tsx --env-file=.env scripts/capture-form300.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPrivateKey, createHash } from "node:crypto";
import { SignJWT } from "jose";
import { PDFDocument } from "pdf-lib";
import { extractAcroFields } from "../lib/form-ai/extract";

const GUID = "07746681-f55d-49c2-a47a-e54593fe84f0";

// DocuSign tab kind → our DetectedFieldType.
const TAB_TYPE: Record<string, string> = {
  textTabs: "text",
  numericalTabs: "text",
  fullNameTabs: "text",
  emailAddressTabs: "text",
  checkboxTabs: "checkbox",
  signHereTabs: "signature",
  initialHereTabs: "initial",
  dateSignedTabs: "date",
  dateTabs: "date",
};

async function main() {
  const e = process.env as Record<string, string>;
  const base = e.DOCUSIGN_BASE_URL.replace(/\/+$/, "");
  const authHost = base.includes("demo") ? "https://account-d.docusign.com" : "https://account.docusign.com";
  const now = Math.floor(Date.now() / 1000);
  const key = createPrivateKey(e.DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, "\n"));
  const assertion = await new SignJWT({ scope: "signature impersonation" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(e.DOCUSIGN_INTEGRATION_KEY).setSubject(e.DOCUSIGN_USER_ID)
    .setAudience(authHost.replace(/^https?:\/\//, "")).setIssuedAt(now).setExpirationTime(now + 3600)
    .sign(key);
  const token = (await (await fetch(`${authHost}/oauth/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  })).json()).access_token as string;
  const acct = e.DOCUSIGN_ACCOUNT_ID;
  const h = { authorization: `Bearer ${token}` };

  // 1. Read the template metadata + recipients/tabs.
  const meta = await (await fetch(`${base}/restapi/v2.1/accounts/${acct}/templates/${GUID}`, { headers: h })).json();
  const recRes = await fetch(`${base}/restapi/v2.1/accounts/${acct}/templates/${GUID}/recipients?include_tabs=true`, { headers: h });
  const rec = await recRes.json();

  console.log(`read status: HTTP ${recRes.status}`);
  console.log(`template name: ${JSON.stringify(meta.name)}`);
  const signers = (rec.signers ?? []) as Array<{ roleName: string; tabs?: Record<string, Array<Record<string, unknown>>> }>;
  if (recRes.status !== 200 || signers.length === 0) {
    console.error("\n❌ READ FAILED — no signers/tabs. Is this an Envelope Template? STOP.");
    process.exit(2);
  }

  // 2. Download the PDF; page sizes + AcroForm fillability.
  const pdfBytes = new Uint8Array(await (await fetch(`${base}/restapi/v2.1/accounts/${acct}/templates/${GUID}/documents/1`, { headers: { ...h, accept: "application/pdf" } })).arrayBuffer());
  const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const pageH = doc.getPages().map((p) => p.getHeight());
  const acro = await extractAcroFields(pdfBytes);

  // 3. Flatten tabs → seed fields (convert DocuSign top-left → PDF bottom-left).
  type Field = {
    role: string; label: string; type: string; page: number;
    pos_x: number; pos_y: number; width: number; height: number;
  };
  const fields: Field[] = [];
  for (const s of signers) {
    for (const [kind, mapped] of Object.entries(TAB_TYPE)) {
      for (const t of s.tabs?.[kind] ?? []) {
        const label = String(t.tabLabel ?? t.name ?? "");
        if (/^(Text|Checkbox|Signature|Date Signed|Initial) [0-9a-f]{8}/.test(label)) continue; // stray auto-named
        const page = Number(t.pageNumber ?? 1);
        const x = Math.round(Number(t.xPosition));
        const yTop = Math.round(Number(t.yPosition));
        const width = Math.round(Number(t.width) || 0);
        const height = Math.round(Number(t.height) || 0);
        const H = pageH[page - 1] ?? 792;
        fields.push({ role: s.roleName, label, type: mapped, page, pos_x: x, pos_y: Math.round(H - yTop - height), width, height });
      }
    }
  }

  // 4. Summarize.
  const byRole = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const f of fields) {
    byRole.set(f.role, (byRole.get(f.role) ?? 0) + 1);
    byType.set(f.type, (byType.get(f.type) ?? 0) + 1);
  }
  console.log(`\n✅ READ OK — ${fields.length} tabs captured across ${pageH.length} pages`);
  console.log(`underlying PDF AcroForm fields: ${acro.length}  (${acro.length === 0 ? "FLAT — recognition needs a content/byte signal, not an AcroForm fingerprint" : "fillable"})`);
  console.log(`roles: ${[...byRole].map(([r, n]) => `${r}=${n}`).join("  ")}`);
  console.log(`types: ${[...byType].map(([t, n]) => `${t}=${n}`).join("  ")}`);

  // Content hash of the canonical blank — the match signal for this FLAT form
  // (an AcroForm-structure fingerprint can't match a fieldless PDF).
  const fileSha256 = createHash("sha256").update(Buffer.from(pdfBytes)).digest("hex");
  console.log(`blank PDF sha256: ${fileSha256}`);

  const out = {
    guid: GUID, templateName: meta.name, pageCount: pageH.length,
    pageHeights: pageH.map((x) => Math.round(x)),
    acroFormFieldCount: acro.length,
    fileSha256,
    roleMapping: Object.fromEntries(signers.map((s) => [s.roleName, s.roleName])),
    fields,
  };
  const path = join(import.meta.dirname, "form-300-known.json");
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${path}`);
}
main().catch((err) => { console.error(err); process.exit(1); });
