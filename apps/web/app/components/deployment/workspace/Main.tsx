"use client";

import DeploymentWorkspaceContainer from "../../deployment-workspace/DeploymentWorkspaceContainer";
import type { DeploymentWorkspaceProps } from "../../deployment-workspace/types";

export default function DeploymentWorkspace(props: DeploymentWorkspaceProps) {
  return <DeploymentWorkspaceContainer {...props} />;
}
