/**
 * Recipient derivation for DocuSign sends. Pure functions over already-fetched
 * deal people (participants + the agent) so they unit-test without mocks — the
 * route layer loads the rows and hands them in.
 *
 * Template path: deal participant roles map to template role names via the
 * form's roleMapping; routing order lives on the template, never here. Matched
 * portal people carry userId (identity link for recipient rows) AND
 * clientUserId = users.id — they sign EMBEDDED in-app (no DocuSign email).
 * Outside signers (email/name override) get neither: DocuSign emails them a
 * secure signing link, by design.
 *
 * Fallback (ad-hoc) path: routing policy buyer → seller → agent.
 */
import type { DocusignSigner, TemplateRole } from "./docusign";

export class RoutingError extends Error {}

export type DealPerson = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

export type RoleOverride = {
  role_name: string;
  user_id?: string;
  email?: string;
  name?: string;
};

// Ad-hoc fallback signing order. Unlisted roles sign last.
const FALLBACK_ORDER: Record<string, number> = { buyer: 1, seller: 2, agent: 3 };

export function assignTemplateRoles(opts: {
  roleMapping: Record<string, string>;
  people: DealPerson[];
  overrides?: RoleOverride[];
}): TemplateRole[] {
  const { roleMapping, people, overrides = [] } = opts;

  return Object.entries(roleMapping).map(([participantRole, templateRole]) => {
    const override = overrides.find((o) => o.role_name === templateRole);

    if (override?.user_id) {
      const person = people.find((p) => p.userId === override.user_id);
      if (!person) {
        throw new RoutingError(
          `override for role "${templateRole}" names a user who is not on this deal`
        );
      }
      return {
        roleName: templateRole,
        name: person.name,
        email: person.email,
        userId: person.userId,
        clientUserId: person.userId,
      };
    }

    if (override?.email && override?.name) {
      // Outside signer: no portal account, no clientUserId — DocuSign emails them.
      return { roleName: templateRole, name: override.name, email: override.email };
    }

    const person = people.find((p) => p.role === participantRole);
    if (!person) {
      throw new RoutingError(
        `this form needs a ${templateRole}; the deal has no ${participantRole}`
      );
    }
    return {
      roleName: templateRole,
      name: person.name,
      email: person.email,
      userId: person.userId,
      clientUserId: person.userId,
    };
  });
}

// "consumers" routing: the deal's client-side people (buyers on a buy deal,
// sellers on a sell deal — never the agent) fill the ordered consumerRoles.
// Consumer1 (index 0) is required; later roles are optional and skipped when
// there's no matching person. Used by statewide UNIFORM notices that both
// sides sign. Consumers are portal users → embedded signing (clientUserId).
export function assignConsumerRoles(
  people: DealPerson[],
  consumerRoles: string[]
): TemplateRole[] {
  if (consumerRoles.length === 0) {
    throw new RoutingError("consumers form has no consumer roles configured");
  }
  // Deterministic order (matches consumer_name / consumer_name_2 prefill).
  const consumers = people
    .filter((p) => p.role === "buyer" || p.role === "seller")
    .slice()
    .sort((a, b) => a.userId.localeCompare(b.userId));

  if (consumers.length === 0) {
    throw new RoutingError("this form needs at least one buyer or seller to sign");
  }

  return consumers.slice(0, consumerRoles.length).map((p, i) => ({
    roleName: consumerRoles[i],
    name: p.name,
    email: p.email,
    userId: p.userId,
    clientUserId: p.userId,
  }));
}

export function deriveFallbackSigners(
  people: DealPerson[],
  selectedUserIds: string[]
): DocusignSigner[] {
  const selected = selectedUserIds.map((id) => {
    const person = people.find((p) => p.userId === id);
    if (!person) {
      throw new RoutingError(`selected signer ${id} is not on this deal`);
    }
    return person;
  });

  return selected
    .slice()
    .sort(
      (a, b) => (FALLBACK_ORDER[a.role] ?? 99) - (FALLBACK_ORDER[b.role] ?? 99)
    )
    .map((p, i) => ({
      email: p.email,
      name: p.name,
      userId: p.userId,
      clientUserId: p.userId,
      routingOrder: i + 1,
    }));
}
