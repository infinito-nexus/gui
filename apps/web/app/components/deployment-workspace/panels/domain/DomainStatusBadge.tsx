import styles from "../../../DeploymentWorkspace.module.css";
import type { DomainStatus } from "../../types";

const STATUS_CLASS: Record<DomainStatus, string> = {
  reserved: styles.domainStatusReserved,
  ordered: styles.domainStatusOrdered,
  active: styles.domainStatusActive,
  disabled: styles.domainStatusDisabled,
  failed: styles.domainStatusFailed,
  cancelled: styles.domainStatusCancelled,
};

export function DomainStatusBadge({ status }: { status: DomainStatus }) {
  return (
    <span className={`${styles.domainStatusBadge} ${STATUS_CLASS[status]}`}>
      {status}
    </span>
  );
}
