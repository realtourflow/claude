/**
 * Which Settings tab to open on first render.
 *
 * After an OAuth calendar connect, the callback bounces the browser to
 * /agent/settings?integrations=<provider>_(connected|error)&reason=… . We open
 * the Integrations tab in that case so its return-flow handler (status refresh
 * on success, error toast on failure) actually runs — that logic lives inside
 * IntegrationsSection, which only mounts when its tab is active.
 */
export function settingsTabFromSearch(
  search: string
): "integrations" | "profile" {
  return new URLSearchParams(search).has("integrations") ? "integrations" : "profile";
}
