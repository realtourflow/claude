import { prisma } from "./db";

export type DealMessageAccess = {
  isAgent: boolean;
  hasAccess: boolean;
  agentId: string | null;
};

/**
 * Resolves the caller's relationship to a deal for messaging purposes.
 * Mirrors dealAccessForMessages in backend/internal/handlers/messages.go.
 */
export async function getMessageAccess(
  dealId: string,
  userId: string
): Promise<DealMessageAccess> {
  const rows = await prisma.$queryRaw<
    { agent_id: string; is_agent: boolean; has_access: boolean }[]
  >`
    SELECT
      agent_id,
      agent_id = ${userId}::uuid AS is_agent,
      (agent_id = ${userId}::uuid OR EXISTS (
        SELECT 1 FROM deal_participants dp
        WHERE dp.deal_id = ${dealId}::uuid AND dp.user_id = ${userId}::uuid
      )) AS has_access
    FROM deals WHERE id = ${dealId}::uuid
  `;
  const row = rows[0];
  if (!row) return { isAgent: false, hasAccess: false, agentId: null };
  return {
    isAgent: row.is_agent,
    hasAccess: row.has_access,
    agentId: row.agent_id,
  };
}

export type MessageRow = {
  id: string;
  deal_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  channel: string;
  body: string;
  created_at: Date;
};

export async function listMessages(
  dealId: string,
  channel: "client_thread" | "internal"
): Promise<MessageRow[]> {
  return prisma.$queryRaw<MessageRow[]>`
    SELECT m.id, m.deal_id, m.sender_id, u.name AS sender_name, u.role::text AS sender_role,
           m.channel, m.body, m.created_at
    FROM messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.deal_id = ${dealId}::uuid AND m.channel = ${channel}
    ORDER BY m.created_at ASC
  `;
}

/**
 * Atomic insert + join — matches the CTE in CreateMessage(messages.go:128).
 * The single round-trip returns the new row with sender_name/sender_role
 * already populated so the client doesn't need a follow-up SELECT.
 */
export async function createMessage(input: {
  dealId: string;
  senderId: string;
  channel: "client_thread" | "internal";
  body: string;
}): Promise<MessageRow> {
  const rows = await prisma.$queryRaw<MessageRow[]>`
    WITH inserted AS (
      INSERT INTO messages (deal_id, sender_id, channel, body)
      VALUES (${input.dealId}::uuid, ${input.senderId}::uuid, ${input.channel}, ${input.body})
      RETURNING id, deal_id, sender_id, channel, body, created_at
    )
    SELECT i.id, i.deal_id, i.sender_id, u.name AS sender_name, u.role::text AS sender_role,
           i.channel, i.body, i.created_at
    FROM inserted i
    JOIN users u ON u.id = i.sender_id
  `;
  return rows[0];
}
