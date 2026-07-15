/**
 * FF1 — best-effort notification emails on top of lib/email.ts.
 *
 * The app already persists in-app notifications (the `notifications` table) for
 * new messages, document uploads, and task assignments. These helpers add email
 * delivery for the same three events. Each helper:
 *   - resolves recipients server-side from the deal (agent_id + deal_participants),
 *   - never emails the actor (sender / uploader / assigner),
 *   - is invoked best-effort by the route: a throw must never block the mutation
 *     (the route wraps the call in a try/catch that swallows — see the routes).
 *
 * The deep link is RECIPIENT-ROLE-AWARE: the app has no single per-deal route
 * shared across roles. Agents/admins use the agent deal route (`/agent/deals/:id`);
 * buyers and sellers land on their own portal (`/buyer/:userId`, `/seller/:userId`),
 * which is the only client deal view and is keyed by the user, not the deal; TCs
 * use the TC deals dashboard. A client-facing email must NOT link to the agent-only
 * route. The origin is taken from the request (`protocol://host`) so links work
 * across local / preview / prod without a hardcoded scheme.
 *
 * Preference / opt-out: `user_settings` has only a free-form JSONB `settings`
 * column with no email-notification field and no existing convention for one, so
 * the behavior is DEFAULT-ON (always send). If a typed opt-out column is added
 * later, gate the sends here in one place.
 */
import { prisma } from "./db";
import { sendNotificationEmail } from "./email";

function originFromRequest(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

/**
 * Role-appropriate deep link for a recipient. Clients land on their own portal
 * (keyed by their userId — the app's only client deal view); agents/admins use
 * the agent deal route; TCs use the TC deals dashboard.
 *
 * Exported (#291) so in-app notification hrefs reuse the EXACT same role→URL
 * mapping as these emails. Pass `origin=""` for a relative path (what the
 * Next `<Link>` in the notification bell wants); pass a real origin for the
 * absolute links the emails need.
 */
export function recipientUrl(
  origin: string,
  role: string,
  userId: string,
  dealId: string
): string {
  switch (role) {
    case "buyer":
      return `${origin}/buyer/${userId}`;
    case "seller":
      return `${origin}/seller/${userId}`;
    case "tc":
      return `${origin}/tc/deals`;
    default: // agent, admin, lending_partner
      return `${origin}/agent/deals/${dealId}`;
  }
}

type Participant = { user_id: string; email: string; role: string };
type Recipient = { email: string; url: string };

/** The deal's client participants (buyers/sellers) with their emails + roles. */
async function clientParticipants(dealId: string): Promise<Participant[]> {
  return prisma.$queryRaw<Participant[]>`
    SELECT dp.user_id, u.email, dp.role::text AS role
    FROM deal_participants dp
    JOIN users u ON u.id = dp.user_id
    WHERE dp.deal_id = ${dealId}::uuid
      AND dp.role IN ('buyer', 'seller')
  `;
}

/**
 * The internal-thread TC recipients (#178): the deal agent's linked TC
 * (users.tc_user_id) plus any TC deal participants. UNION dedupes a linked TC
 * who is also a participant. Never returns buyers/sellers — the internal
 * thread is "Agent + TC only" (#177).
 */
async function internalTCs(dealId: string): Promise<Participant[]> {
  return prisma.$queryRaw<Participant[]>`
    SELECT tc.id AS user_id, tc.email, 'tc'::text AS role
    FROM deals d
    JOIN users agent ON agent.id = d.agent_id
    JOIN users tc ON tc.id = agent.tc_user_id
    WHERE d.id = ${dealId}::uuid
    UNION
    SELECT dp.user_id, u.email, 'tc'::text AS role
    FROM deal_participants dp
    JOIN users u ON u.id = dp.user_id
    WHERE dp.deal_id = ${dealId}::uuid AND dp.role = 'tc'
  `;
}

/** The deal's agent (id + email). */
async function dealAgent(
  dealId: string
): Promise<{ id: string; email: string } | null> {
  const rows = await prisma.$queryRaw<{ id: string; email: string }[]>`
    SELECT u.id, u.email
    FROM deals d
    JOIN users u ON u.id = d.agent_id
    WHERE d.id = ${dealId}::uuid
  `;
  return rows[0] ?? null;
}

/** Send to each unique recipient with their own role-appropriate link. */
async function fanOut(
  recipients: Recipient[],
  fields: { subject: string; heading: string; body: string }
): Promise<void> {
  const seen = new Set<string>();
  for (const r of recipients) {
    if (!r.email || seen.has(r.email)) continue;
    seen.add(r.email);
    await sendNotificationEmail({
      to: r.email,
      subject: fields.subject,
      heading: fields.heading,
      body: fields.body,
      dealUrl: r.url,
    });
  }
}

/**
 * New message: email the OTHER party. Never the sender.
 *
 * client_thread — agent sender → email the client participant(s); client
 * sender → email the agent.
 *
 * internal (#178) — the thread is "Agent + TC only" (#177), so clients are
 * NEVER emailed. Agent sender → email the TC(s) (the agent's linked TC +
 * any TC participants); TC sender → email the agent.
 */
export async function emailNewMessage(input: {
  req: Request;
  dealId: string;
  senderId: string;
  senderIsAgent: boolean;
  channel: "client_thread" | "internal";
  body: string;
}): Promise<void> {
  const { req, dealId, senderId, senderIsAgent, channel, body } = input;
  const origin = originFromRequest(req);
  const snippet = body.length > 140 ? body.slice(0, 140) + "…" : body;

  let recipients: Recipient[] = [];
  if (senderIsAgent && channel === "internal") {
    const tcs = await internalTCs(dealId);
    recipients = tcs
      .filter((tc) => tc.user_id !== senderId)
      .map((tc) => ({
        email: tc.email,
        url: recipientUrl(origin, tc.role, tc.user_id, dealId),
      }));
  } else if (senderIsAgent) {
    const clients = await clientParticipants(dealId);
    recipients = clients
      .filter((c) => c.user_id !== senderId)
      .map((c) => ({
        email: c.email,
        url: recipientUrl(origin, c.role, c.user_id, dealId),
      }));
  } else {
    const agent = await dealAgent(dealId);
    if (agent && agent.id !== senderId) {
      recipients = [
        {
          email: agent.email,
          url: recipientUrl(origin, "agent", agent.id, dealId),
        },
      ];
    }
  }

  await fanOut(recipients, {
    subject: "New message on your RealTourFlow deal",
    heading: "You have a new message",
    body: `New message: "${snippet}"`,
  });
}

/**
 * Document uploaded/confirmed: email the deal's client(s) AND the deal's agent.
 * Never the uploader.
 *
 * The agent belongs in the recipient set whenever they are not the uploader
 * (#293): when a CLIENT uploads (the "please upload your pre-approval" reply),
 * the agent is the party waiting on it, yet the old client-only fan-out left
 * them out entirely — and on the common single-participant deal the recipient
 * set (clients minus the uploader) was empty, so nobody was emailed and the
 * request-a-doc loop dead-ended silently. When the AGENT uploads, `agent.id ===
 * uploaderId` so they are skipped and only the clients hear about it (unchanged,
 * no self-notify). fanOut dedupes by email, so an agent who is somehow also a
 * client participant is never emailed twice.
 */
export async function emailDocumentUploaded(input: {
  req: Request;
  dealId: string;
  uploaderId: string;
  documentName: string;
}): Promise<void> {
  const { req, dealId, uploaderId, documentName } = input;
  const origin = originFromRequest(req);

  const clients = await clientParticipants(dealId);
  const recipients = clients
    .filter((c) => c.user_id !== uploaderId)
    .map((c) => ({
      email: c.email,
      url: recipientUrl(origin, c.role, c.user_id, dealId),
    }));

  const agent = await dealAgent(dealId);
  if (agent && agent.id !== uploaderId) {
    recipients.push({
      email: agent.email,
      url: recipientUrl(origin, "agent", agent.id, dealId),
    });
  }

  await fanOut(recipients, {
    subject: "A document was shared on your RealTourFlow deal",
    heading: "A document was shared with you",
    body: `"${documentName}" was added to your deal.`,
  });
}

/** Task assigned: email the assignee. Never email the actor who assigned it. */
export async function emailTaskAssigned(input: {
  req: Request;
  dealId: string;
  assigneeId: string;
  actorId: string;
  taskTitle: string;
}): Promise<void> {
  const { req, dealId, assigneeId, actorId, taskTitle } = input;
  if (!assigneeId || assigneeId === actorId) return;

  // Resolve the assignee's email + their role RELATIVE TO THIS DEAL so the link
  // points at the right area (agent route vs client portal vs TC dashboard).
  const rows = await prisma.$queryRaw<{ email: string; role: string }[]>`
    SELECT u.email,
      CASE WHEN d.agent_id = u.id THEN 'agent'
           ELSE COALESCE(dp.role::text, u.role::text) END AS role
    FROM users u
    JOIN deals d ON d.id = ${dealId}::uuid
    LEFT JOIN deal_participants dp
      ON dp.deal_id = d.id AND dp.user_id = u.id
    WHERE u.id = ${assigneeId}::uuid
  `;
  const row = rows[0];
  if (!row?.email) return;

  const origin = originFromRequest(req);
  await sendNotificationEmail({
    to: row.email,
    subject: "You've been assigned a task on RealTourFlow",
    heading: "You've been assigned a task",
    body: `You were assigned: "${taskTitle}".`,
    dealUrl: recipientUrl(origin, row.role, assigneeId, dealId),
  });
}

/**
 * Offer requested on a tracked property (#168): email the deal's agent.
 * Never the requester — if the agent flips the flag themselves, no email.
 * Invoked best-effort by the property PATCH route (a throw must never block
 * the mutation).
 */
export async function emailOfferRequested(input: {
  req: Request;
  dealId: string;
  requesterId: string;
  propertyAddress: string;
}): Promise<void> {
  const { req, dealId, requesterId, propertyAddress } = input;
  const agent = await dealAgent(dealId);
  if (!agent || agent.id === requesterId) return;

  const origin = originFromRequest(req);
  await fanOut(
    [
      {
        email: agent.email,
        url: recipientUrl(origin, "agent", agent.id, dealId),
      },
    ],
    {
      subject: "Offer request on your RealTourFlow deal",
      heading: "Your client wants to make an offer",
      body: `Your client requested to make an offer on "${propertyAddress}". Reach out to discuss next steps.`,
    }
  );
}

// ---------------------------------------------------------------------------
// #175 — intake highlights for the "client joined" agent notification.
// Append-only addition: turns the persisted onboarding answers into a compact
// one-line summary the invite-claim route appends to its email body, so the
// agent's "client joined" email carries real context instead of arriving bare.
// ---------------------------------------------------------------------------

const LENDER_LABELS: Record<string, string> = {
  mountain: "Mountain Mortgage",
  fastpass: "Fast Pass (Mountain Mortgage)",
  other: "Using another lender",
};

function moneyShort(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  return `$${Math.round(n / 1000)}K`;
}

/**
 * A compact " Intake highlights — …" sentence from the questionnaire answers,
 * or "" when there is nothing worth surfacing. Plain text — callers pass it
 * through sendNotificationEmail, which HTML-escapes the body.
 */
export function formatIntakeHighlights(
  role: "buyer" | "seller",
  answers: Record<string, unknown>
): string {
  const str = (k: string): string | null => {
    const v = answers[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const num = (k: string): number | null => {
    const v = answers[k];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };

  const parts: string[] = [];
  if (role === "buyer") {
    const min = num("minBudget");
    const max = num("maxBudget");
    if (min !== null && max !== null) parts.push(`Budget ${moneyShort(min)}–${moneyShort(max)}`);
    const beds = str("bedrooms");
    const baths = str("bathrooms");
    if (beds) parts.push(`${beds} bed${baths ? ` / ${baths} bath` : ""}`);
    const areas = str("areas");
    if (areas) parts.push(`Areas: ${areas}`);
    const journey = str("journeyStage");
    if (journey) parts.push(journey);
    const lender = str("lenderChoice");
    if (lender) parts.push(`Lender: ${LENDER_LABELS[lender] ?? lender}`);
    const tracking = str("trackingAddress");
    if (tracking) parts.push(`First property: ${tracking}`);
  } else {
    const address = str("address");
    if (address) parts.push(`Property: ${address}`);
    const listDate = str("desiredListDate");
    if (listDate) parts.push(`Target list: ${listDate}`);
    const priority = str("whatMattersMost");
    if (priority) parts.push(`Priority: ${priority}`);
    const reasons = answers.reasonsForSelling;
    if (Array.isArray(reasons)) {
      const items = reasons.filter((r): r is string => typeof r === "string" && r.trim() !== "");
      if (items.length > 0) parts.push(`Reason: ${items.join(", ")}`);
    }
    const lender = str("lenderChoice");
    if (lender) parts.push(`Lender: ${LENDER_LABELS[lender] ?? lender}`);
  }

  return parts.length > 0 ? ` Intake highlights — ${parts.join(" · ")}.` : "";
}
