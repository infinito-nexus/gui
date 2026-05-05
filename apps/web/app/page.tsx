export const dynamic = "force-dynamic";

import DeploymentConsole from "./components/deployment/Console";
import LoginPrompt from "./components/LoginPrompt";
import {
  PANEL_QUERY_TO_KEY,
  type PanelKey,
  type Role,
} from "./components/deployment-workspace/types";

function resolveApiServerBaseUrl() {
  const configuredProxyTarget = String(process.env.API_PROXY_TARGET || "").trim();
  if (configuredProxyTarget) {
    return configuredProxyTarget.replace(/\/+$/, "");
  }
  const configuredPublicBaseUrl = String(process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
  if (/^https?:\/\//i.test(configuredPublicBaseUrl)) {
    return configuredPublicBaseUrl.replace(/\/+$/, "");
  }
  return "http://api:8000";
}

async function loadInitialRoles(): Promise<Role[]> {
  try {
    const response = await fetch(`${resolveApiServerBaseUrl()}/api/roles`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function resolveInitialPanel(
  rawValue: string | string[] | undefined
): PanelKey | undefined {
  const value = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized ? PANEL_QUERY_TO_KEY[normalized] : undefined;
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const configuredBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL || "").trim();
  const baseUrl = configuredBaseUrl;
  const streamBaseUrl = String(
    process.env.NEXT_PUBLIC_API_STREAM_BASE_URL || ""
  ).trim();
  const logoUrl =
    process.env.NEXT_PUBLIC_BRAND_LOGO_URL || "/brand-logo.png";
  const initialRoles = await loadInitialRoles();
  const initialPanel = resolveInitialPanel(resolvedSearchParams.ui_panel);
  const initialWorkspaceId = (() => {
    const value = resolvedSearchParams.workspace;
    const first = Array.isArray(value) ? value[0] : value;
    const normalized = String(first || "").trim();
    return normalized || undefined;
  })();

  return (
    <main
      style={{
        padding: "24px",
        height: "100vh",
        maxWidth: 1180,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        overflow: "hidden",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <div style={{ flex: "1 1 420px" }}>
          <h1
            className="text-body"
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: 34,
              letterSpacing: "-0.03em",
            }}
          >
            Infinito.Nexus Store
          </h1>
          <p
            className="text-body-secondary"
            style={{
              marginTop: 8,
              fontSize: 15,
            }}
          >
            Software on your infrastructure. Data under your control.
          </p>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            minWidth: 160,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: "var(--bs-body-bg)",
              border: "1px solid var(--bs-border-color-translucent)",
              display: "grid",
              placeItems: "center",
              overflow: "hidden",
              boxShadow: "var(--deployer-shadow)",
            }}
            aria-label="Infinito.Nexus logo"
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Infinito.Nexus logo"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            ) : (
              <i className="fa-solid fa-circle-nodes" aria-hidden="true" />
            )}
          </div>
          <div
            id="workspace-switcher-slot"
            style={{ width: "100%", display: "grid", placeItems: "center" }}
          />
        </div>
      </header>

      <section
        style={{
          flex: 1,
          minHeight: 0,
          padding: 0,
          borderRadius: 0,
          background: "transparent",
          border: "none",
          overflow: "hidden",
        }}
      >
        <div style={{ height: "100%", overflow: "hidden" }}>
          <DeploymentConsole
            baseUrl={baseUrl}
            streamBaseUrl={streamBaseUrl}
            initialRoles={initialRoles}
            initialPanel={initialPanel}
            initialWorkspaceId={initialWorkspaceId}
          />
        </div>
      </section>

      {/*
        LoginPrompt only mounts when auth is actually available. The e2e
        header-mock path leaves NEXT_PUBLIC_INFINITO_AUTH_AVAILABLE unset
        so the modal does not block existing anonymous tests; production
        and the OIDC-mode e2e (req 020) opt in.
      */}
      {String(process.env.NEXT_PUBLIC_INFINITO_AUTH_AVAILABLE || "").toLowerCase() === "true" && (
        <LoginPrompt />
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {[
            "Support",
            "Source Code",
            "Follow Us",
            "Contact",
            "Imprint",
          ].map((label) => (
            <span
              key={label}
              style={{
                color: "var(--bs-secondary-color)",
                fontSize: 12,
                textDecoration: "underline",
                textUnderlineOffset: "2px",
                cursor: "pointer",
              }}
            >
              {label}
            </span>
          ))}
        </div>
        <span className="text-body-secondary" style={{ fontSize: 12 }}>
          Infinito.Nexus by Kevin Veen-Birkenbach
        </span>
      </div>
    </main>
  );
}
