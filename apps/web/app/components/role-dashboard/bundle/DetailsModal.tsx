"use client";

import BundleAppList, { type BundleAppListRow } from "./AppList";
import styles from "../styles";
import type { Bundle, Role } from "./types";

type BundleDetailsModalProps = {
  bundle: Bundle | null;
  roleRows: BundleAppListRow[];
  totalPriceLabel: string;
  appsCaption: string;
  onOpenRoleDetails?: (role: Role) => void;
  onClose: () => void;
};

function bundleIconClass(bundle: Bundle): string {
  const raw = String(bundle.logo_class || "").trim();
  return raw || "fa-solid fa-layer-group";
}

export default function BundleDetailsModal({
  bundle,
  roleRows,
  totalPriceLabel,
  appsCaption,
  onOpenRoleDetails,
  onClose,
}: BundleDetailsModalProps) {
  if (!bundle) return null;

  return (
    <div className={styles.bundleDetailsOverlay} onClick={onClose}>
      <div className={styles.bundleDetailsCard} onClick={(event) => event.stopPropagation()}>
        <div className={styles.bundleDetailsHeader}>
          <div className={styles.bundleDetailsTitleWrap}>
            <span className={styles.bundleDetailsIconWrap}>
              <i className={`${bundleIconClass(bundle)} ${styles.bundleDetailsIcon}`} aria-hidden="true" />
            </span>
            <div className={styles.bundleDetailsTitleText}>
              <h3 className={styles.bundleDetailsTitle}>{bundle.title}</h3>
              <p className={styles.bundleDetailsSubTitle}>{bundle.id}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className={styles.bundleDetailsCloseButton}>
            Close
          </button>
        </div>

        <div className={styles.bundleDetailsBody}>
          <div className={styles.bundleDetailsHero}>
            <span className={styles.bundleDetailsHeroIconWrap}>
              <i
                className={`${bundleIconClass(bundle)} ${styles.bundleDetailsHeroIcon}`}
                aria-hidden="true"
              />
            </span>
          </div>
          <p className={`text-body-secondary ${styles.bundleDetailsDescription}`}>
            {bundle.description || "No description provided."}
          </p>
          <div className={styles.bundleDetailsStats}>
            <div className={styles.bundleDetailsStat}>
              <span className={styles.bundleDetailsStatLabel}>Target</span>
              <span className={styles.bundleDetailsStatValue}>
                {bundle.deploy_target || "bundle"}
              </span>
            </div>
            <div className={styles.bundleDetailsStat}>
              <span className={styles.bundleDetailsStatLabel}>Total</span>
              <span className={styles.bundleDetailsStatValue}>{totalPriceLabel}</span>
            </div>
            <div className={styles.bundleDetailsStat}>
              <span className={styles.bundleDetailsStatLabel}>Enabled</span>
              <span className={styles.bundleDetailsStatValue}>{appsCaption}</span>
            </div>
          </div>
          <div className={styles.bundleDetailsAppListWrap}>
            <BundleAppList
              bundleId={`details:${bundle.id}`}
              rows={roleRows}
              pageSize={6}
              onOpenRoleDetails={onOpenRoleDetails}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
