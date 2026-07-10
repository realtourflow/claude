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
 */
function recipientUrl(
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

/** Document uploaded/confirmed: email the deal's client(s). Never the uploader. */
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
