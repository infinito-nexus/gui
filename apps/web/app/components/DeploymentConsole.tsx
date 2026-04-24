"use client";

import DeploymentWorkspace from "./DeploymentWorkspace";
import type { Role } from "./deployment-workspace/types";

export default function DeploymentConsole({
  baseUrl,
  streamBaseUrl,
  initialRoles,
  initialPanel,
  initialWorkspaceId,
}: {
  baseUrl: string;
  streamBaseUrl?: string;
  initialRoles?: Role[];
  initialPanel?: import("./deployment-workspace/types").PanelKey;
  initialWorkspaceId?: string;
}) {
  return (
    <DeploymentWorkspace
      baseUrl={baseUrl}
      streamBaseUrl={streamBaseUrl}
      initialRoles={initialRoles}
      initialPanel={initialPanel}
      initialWorkspaceId={initialWorkspaceId}
    />
  );
}
