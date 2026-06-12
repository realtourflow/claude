/**
 * Contract prefill: turns merged contract values (deal facts ∪ per-form terms)
 * into per-role DocuSign tab payloads via the form's fieldMap. Pure — the send
 * route resolves the values server-side and hands them in; nothing here talks
 * to the DB or DocuSign.
 *
 * Tab labels come from the template (tagged once in the DocuSign account);
 * `role` on a fieldMap entry targets which template role's tabs carry the
 * value (templates only apply tabs to the role they're assigned to), falling
 * back to the form's first role.
 */
import type { FieldMapEntry } from "./docusign-templates";
import type { TemplateRoleTabs } from "./docusign";

export type RoleTabs = TemplateRoleTabs;

function formatTextValue(value: unknown): string {
  if (value instanceof Date) {
    // US-contract convention: MM/DD/YYYY (dates are date-only columns; use UTC
    // so the calendar day never shifts with the server timezone).
    const mm = String(value.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(value.getUTCDate()).padStart(2, "0");
    return `${mm}/${dd}/${value.getUTCFullYear()}`;
  }
  return String(value);
}

export function buildPrefillTabs(opts: {
  fieldMap: Record<string, FieldMapEntry>;
  values: Record<string, unknown>;
  defaultRole: string;
}): Record<string, RoleTabs> {
  const out: Record<string, RoleTabs> = {};

  for (const [key, entry] of Object.entries(opts.fieldMap)) {
    const value = opts.values[key];
    // No value = leave the template field blank for the signers to handle.
    // (Explicit `false` IS a value — it unchecks a template default.)
    if (value === undefined || value === null || value === "") continue;

    const role = entry.role ?? opts.defaultRole;
    const roleTabs = (out[role] ??= {});

    if (entry.type === "checkbox") {
      (roleTabs.checkboxTabs ??= []).push({
        tabLabel: entry.label,
        selected: value ? "true" : "false",
      });
    } else {
      (roleTabs.textTabs ??= []).push({
        tabLabel: entry.label,
        value: formatTextValue(value),
      });
    }
  }

  return out;
}
