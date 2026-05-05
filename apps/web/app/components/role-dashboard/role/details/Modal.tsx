"use client";

import { useEffect, useState } from "react";
import EnableDropdown from "../../EnableDropdown";
import RoleDetailsFormsTab from "./FormsTab";
import RoleDetailsServicesTab from "./ServicesTab";
import RoleLogoView from "../LogoView";
import RoleQuickLinks from "../QuickLinks";
import { displayCategories, displayTargets } from "../../helpers";
import styles from "../../styles";
import { WORKSPACE_STORAGE_KEY } from "../../../workspace-panel/utils";
import type { Role } from "../../types";

type RoleDetailsModalProps = {
  role: Role | null;
  aliases: string[];
  selectedAlias: string;
  selected: boolean;
  plans: { id: string; label: string }[];
  selectedPlanId: string | null;
  serverCount: number;
  onAliasChange: (alias: string) => void;
  onSelectPlan: (planId: string | null) => void;
  onEnable: () => void;
  onDisable: () => void;
  expertMode?: boolean;
  onEditRoleConfig?: () => void;
  onOpenVideo: (url: string, title: string) => void;
  onClose: () => void;
};

type TabKey = "general" | "services" | "forms" | "billing";

const TAB_LABELS: Record<TabKey, string> = {
  general: "General",
  services: "Services",
  forms: "Forms",
  billing: "Billing",
};

function readWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  const value = String(window.localStorage.getItem(WORKSPACE_STORAGE_KEY) || "").trim();
  return value || null;
}

export default function RoleDetailsModal({
  role,
  aliases,
  selectedAlias,
  selected,
  plans,
  selectedPlanId,
  serverCount,
  onAliasChange,
  onSelectPlan,
  onEnable,
  onDisable,
  expertMode = false,
  onEditRoleConfig,
  onOpenVideo,
  onClose,
}: RoleDetailsModalProps) {
  const [activeTab, setActiveTab] = useState<TabKey>("general");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);

  useEffect(() => {
    setWorkspaceId(readWorkspaceId());
  }, [role?.id]);

  if (!role) return null;

  const targets = displayTargets(role.deployment_targets ?? []);
  const categories = displayCategories(role.categories);
  const tags = displayCategories(role.galaxy_tags);
  const tabs: TabKey[] = ["general", "services", "forms", "billing"];

  const renderGeneral = () => (
    <>
      <p className={`text-body-secondary ${styles.roleDetailsDescription}`}>
        {role.description || "No description provided."}
      </p>

      {targets.length > 0 ? (
        <div className={styles.roleDetailsSection}>
          <span className={styles.roleDetailsSectionLabel}>Targets</span>
          <div className={styles.roleDetailsPillRow}>
            {targets.map((target) => (
              <span key={`${role.id}:${target}`} className={styles.targetBadge}>
                {target}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {categories.length > 0 ? (
        <div className={styles.roleDetailsSection}>
          <span className={styles.roleDetailsSectionLabel}>Categories</span>
          <div className={styles.roleDetailsPillRow}>
            {categories.map((entry) => (
              <span key={`${role.id}:category:${entry}`} className={styles.targetBadge}>
                {entry}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {tags.length > 0 ? (
        <div className={styles.roleDetailsSection}>
          <span className={styles.roleDetailsSectionLabel}>Tags</span>
          <div className={styles.roleDetailsPillRow}>
            {tags.map((entry) => (
              <span key={`${role.id}:tag:${entry}`} className={styles.targetBadge}>
                {entry}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className={styles.roleDetailsSection}>
        <span className={styles.roleDetailsSectionLabel}>Links</span>
        <div className={styles.roleDetailsLinks}>
          <RoleQuickLinks role={role} onOpenVideo={onOpenVideo} adaptiveOverflow />
        </div>
      </div>
    </>
  );

  const renderBilling = () => (
    <div className={styles.roleDetailsControlWrap}>
      {expertMode && onEditRoleConfig ? (
        <div className={styles.roleDetailsActions}>
          <button
            type="button"
            onClick={onEditRoleConfig}
            className={`${styles.selectButton} ${styles.selectButtonDefault}`}
          >
            <i className="fa-solid fa-pen-to-square" aria-hidden="true" />
            <span>Edit</span>
          </button>
        </div>
      ) : null}
      <EnableDropdown
        enabled={selected}
        pricingModel="app"
        plans={plans}
        selectedPlanId={selectedPlanId}
        onSelectPlan={onSelectPlan}
        roleId={role.id}
        pricing={role.pricing || null}
        pricingSummary={role.pricing_summary || null}
        serverCount={serverCount}
        appCount={1}
        onEnable={onEnable}
        onDisable={onDisable}
      />
    </div>
  );

  return (
    <div onClick={onClose} className={styles.roleDetailsOverlay}>
      <div
        onClick={(event) => event.stopPropagation()}
        className={styles.roleDetailsCard}
      >
        <div className={styles.roleDetailsHeader}>
          <div className={styles.roleDetailsTitleWrap}>
            <RoleLogoView role={role} size={40} />
            <div className={styles.roleDetailsTitleText}>
              <h3 className={styles.roleDetailsTitle}>{role.display_name}</h3>
              <p className={styles.roleDetailsRoleId}>{role.id}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className={styles.roleDetailsCloseButton}>
            Close
          </button>
        </div>

        <div className={styles.roleDetailsAliasRow}>
          <span className={styles.roleDetailsAliasLabel}>Server</span>
          <select
            value={selectedAlias}
            onChange={(event) => onAliasChange(String(event.target.value || "").trim())}
            className={styles.roleDetailsAliasSelect}
          >
            {aliases.map((alias) => (
              <option key={alias} value={alias}>
                {alias}
              </option>
            ))}
          </select>
        </div>

        <div
          className={styles.roleDetailsTabList}
          role="tablist"
          aria-label="Role detail sections"
        >
          {tabs.map((key) => {
            const active = key === activeTab;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`role-details-panel-${key}`}
                id={`role-details-tab-${key}`}
                onClick={() => setActiveTab(key)}
                className={`${styles.roleDetailsTabButton} ${
                  active ? styles.roleDetailsTabButtonActive : ""
                }`}
              >
                {TAB_LABELS[key]}
              </button>
            );
          })}
        </div>

        <div
          id={`role-details-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`role-details-tab-${activeTab}`}
          className={`${styles.roleDetailsBody} ${styles.roleDetailsTabPanel}`}
        >
          {activeTab === "general" ? renderGeneral() : null}
          {activeTab === "services" ? (
            <RoleDetailsServicesTab
              role={role}
              workspaceId={workspaceId}
              alias={selectedAlias || null}
            />
          ) : null}
          {activeTab === "forms" ? (
            <RoleDetailsFormsTab
              role={role}
              workspaceId={workspaceId}
              alias={selectedAlias || null}
            />
          ) : null}
          {activeTab === "billing" ? renderBilling() : null}
        </div>
      </div>
    </div>
  );
}
