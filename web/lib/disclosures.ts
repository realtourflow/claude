/**
 * Disclosure packet assembly (FF5 #23).
 *
 * Merges a set of already-uploaded PDF deal documents into ONE PDF so the
 * packet can be stored as a regular `documents` row and sent for signature
 * through the existing DocuSign path — the webhook and document status tags
 * then track it with no extra plumbing.
 */
import { PDFDocument } from "pdf-lib";
import { prisma } from "./db";
import { getObjectBytes } from "./s3";

export type DisclosureErrorCode = "empty" | "not_found" | "not_pdf";

/** Typed validation error — routes map `code` onto an HTTP status. */
export class DisclosureError extends Error {
  constructor(
    public readonly code: DisclosureErrorCode,
    message: string
  ) {
    super(message);
    this.name = "DisclosureError";
  }
}

export type DisclosurePacket = {
  bytes: Uint8Array;
  pageCount: number;
  name: string;
};

/** `Disclosure Packet — Jun 10, 2026` (en-US). */
export function disclosurePacketName(now: Date = new Date()): string {
  const date = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `Disclosure Packet — ${date}`;
}

/**
 * Loads the requested documents, validates they all belong to the deal and
 * are PDFs, then merges them (in the given order) into a single PDF.
 *
 * Throws DisclosureError:
 * - "empty"     — documentIds is empty
 * - "not_found" — an id does not exist on this deal
 * - "not_pdf"   — a selected document is not application/pdf (message names it)
 */
export async function assembleDisclosurePacket(input: {
  dealId: string;
  documentIds: string[];
}): Promise<DisclosurePacket> {
  const { dealId, documentIds } = input;
  if (documentIds.length === 0) {
    throw new DisclosureError(
      "empty",
      "at least one document is required for a disclosure packet"
    );
  }

  const rows = await prisma.documents.findMany({
    where: { id: { in: documentIds }, deal_id: dealId },
    select: { id: true, name: true, s3_key: true, mime_type: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));

  const missing = documentIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new DisclosureError(
      "not_found",
      "document not found on this deal: " + missing.join(", ")
    );
  }

  const nonPdf = documentIds
    .map((id) => byId.get(id)!)
    .filter((r) => r.mime_type !== "application/pdf");
  if (nonPdf.length > 0) {
    throw new DisclosureError(
      "not_pdf",
      "only PDF documents can be included in a disclosure packet: " +
        nonPdf.map((r) => r.name).join(", ")
    );
  }

  // Merge in the order the caller selected.
  const merged = await PDFDocument.create();
  for (const id of documentIds) {
    const src = await PDFDocument.load(await getObjectBytes(byId.get(id)!.s3_key));
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }

  return {
    bytes: await merged.save(),
    pageCount: merged.getPageCount(),
    name: disclosurePacketName(),
  };
}
