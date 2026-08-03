export const crmAIntegrationsBrand = {
  displayName: "Crm-A Integrations",
  singularDisplayName: "Crm-A Integration",
  searchLabel: "Searching Crm-A Integrations",
  callLabel: "Calling Crm-A Integration",
  genericToolLabel: "Using Crm-A Integrations",
  attentionLabel: "Crm-A Integrations needs attention",
} as const;

export function formatCrmAIntegrationsStatusError(
  action: "load" | "update",
  status?: number,
): string {
  const base = `Failed to ${action} ${crmAIntegrationsBrand.displayName} status`;
  return typeof status === "number" ? `${base} (${status})` : `${base}.`;
}
