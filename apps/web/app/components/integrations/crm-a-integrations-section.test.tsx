// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CrmAIntegrationsSection } from "./crm-a-integrations-section";
import type { IntegrationsState } from "@/lib/integrations";

const integrationsState: IntegrationsState = {
  crmACloud: {
    hasKey: true,
    isPrimaryProvider: true,
    primaryModel: "gpt-5.4",
  },
  metadata: {
    schemaVersion: 1,
    exa: {},
    apollo: {},
    elevenlabs: {},
  },
  search: {
    builtIn: { enabled: true, denied: false, provider: null },
    effectiveOwner: "web_search",
  },
  managedPlugins: [],
  integrations: [
    {
      id: "apollo",
      label: "Apollo Enrichment",
      enabled: true,
      available: true,
      locked: false,
      lockReason: null,
      lockBadge: null,
      gatewayBaseUrl: "https://gateway.example.com",
      auth: { configured: true, source: "config" },
      plugin: null,
      managedByCrmA: true,
      healthIssues: [],
      health: {
        status: "healthy",
        pluginMissing: false,
        pluginInstalledButDisabled: false,
        configMismatch: false,
        missingAuth: false,
        missingGatewayOverride: false,
      },
    },
  ],
};

describe("CrmAIntegrationsSection", () => {
  it("renders Apollo enrichment with Crm-A branding in settings", () => {
    const { container } = render(
      <CrmAIntegrationsSection
        data={integrationsState}
        loading={false}
        error={null}
      />,
    );

    expect(screen.getByText("Crm-A Enrichments")).toBeInTheDocument();
    expect(screen.queryByText("Apollo Enrichment")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Toggle Crm-A Enrichments" })).toBeInTheDocument();
    expect(container.querySelector('img[src="/crm-a-workspace-icon.png"]')).toBeTruthy();
  });
});
