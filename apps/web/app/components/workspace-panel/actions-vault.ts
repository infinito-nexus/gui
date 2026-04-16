import { setWorkspaceMasterPassword } from "../../lib/workspaceVaultSession";
import { extractVaultText, replaceVaultBlock } from "./utils";

type CredentialsTarget = {
  alias: string;
  targetRoles: string[];
};

export function createWorkspacePanelVaultActions(ctx: any) {
  const {
    baseUrl,
    workspaceId,
    activeAlias,
    activePath,
    allowEmptyPlain,
    credentialsBusy,
    credentialsScope,
    credentialsRole,
    forceOverwrite,
    hasCredentialsVault,
    pendingCredentials,
    vaultPromptMode,
    masterChangeValues,
    masterChangeMode,
    keyPassphraseModal,
    keyPassphraseValues,
    vaultValueModal,
    vaultValueInputs,
    editorValue,
    refreshFiles,
    resolveTargetRoles,
    setCredentialsBusy,
    setCredentialsError,
    setCredentialsStatus,
    setPendingCredentials,
    setVaultPromptMode,
    setVaultPromptConfirm,
    setVaultPromptOpen,
    setMasterChangeBusy,
    setMasterChangeError,
    setMasterChangeOpen,
    setMasterChangeValues,
    setKeyPassphraseBusy,
    setKeyPassphraseError,
    setKeyPassphraseModal,
    setKeyPassphraseValues,
    setEditorMenu,
    setVaultValueInputs,
    setVaultValueModal,
    setEditorValue,
    setEditorDirty,
  } = ctx;

  const toUserError = (err: any, fallback: string) => {
    const raw = String(err?.message ?? "").trim();
    if (!raw) return fallback;
    if (raw === "Failed to fetch") {
      return "API unreachable. Check web/api connection and reload.";
    }
    return raw;
  };

  const postCredentialsRequest = async (
    targetRoles: string[],
    force: boolean,
    setValues: string[],
    masterPassword: string,
    aliasOverride?: string
  ) => {
    const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        master_password: masterPassword,
        selected_roles: targetRoles,
        allow_empty_plain: allowEmptyPlain,
        set_values: setValues.length > 0 ? setValues : undefined,
        force,
        alias: aliasOverride || activeAlias || undefined,
      }),
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const data = await res.json();
        if (data?.detail) message = data.detail;
      } catch {
        // ignore
      }
      throw new Error(message);
    }
  };

  const postCredentials = async (
    targetRoles: string[],
    force: boolean,
    setValues: string[],
    masterPassword: string,
    aliasOverride?: string
  ) => {
    if (!workspaceId || !masterPassword || credentialsBusy) return;
    setCredentialsBusy(true);
    setCredentialsError(null);
    setCredentialsStatus(null);
    try {
      await postCredentialsRequest(
        targetRoles,
        force,
        setValues,
        masterPassword,
        aliasOverride
      );
      setWorkspaceMasterPassword(workspaceId, masterPassword);
      setCredentialsStatus("Credentials generated.");
      await refreshFiles(workspaceId);
    } catch (err: any) {
      setCredentialsError(toUserError(err, "credential generation failed"));
    } finally {
      setCredentialsBusy(false);
    }
  };

  const generateCredentials = async (
    options?: {
      scope?: "all" | "single";
      role?: string;
      force?: boolean;
      alias?: string;
      targetRoles?: string[];
      targets?: CredentialsTarget[];
    }
  ) => {
    if (!workspaceId || credentialsBusy) return;
    const scope = options?.scope ?? credentialsScope;
    const role = options?.role ?? credentialsRole;
    const force = options?.force ?? forceOverwrite;
    const alias = options?.alias || activeAlias;
    const targets = Array.isArray(options?.targets)
      ? options.targets
          .map((target) => ({
            alias: String(target.alias || "").trim(),
            targetRoles: Array.isArray(target.targetRoles)
              ? target.targetRoles.map((roleId) => String(roleId || "").trim()).filter(Boolean)
              : [],
          }))
          .filter((target) => target.alias && target.targetRoles.length > 0)
      : [];
    if (targets.length > 0) {
      setPendingCredentials({
        roles: [],
        force,
        setValues: [],
        targets,
      });
      setVaultPromptMode("generate");
      setVaultPromptConfirm(!hasCredentialsVault);
      setVaultPromptOpen(true);
      return;
    }
    const targetRoles = options?.targetRoles ?? resolveTargetRoles(scope, role);
    if (targetRoles.length === 0) {
      setCredentialsError("Select a role to generate credentials.");
      return;
    }
    setPendingCredentials({
      roles: targetRoles,
      force,
      setValues: [],
      alias,
    });
    setVaultPromptMode("generate");
    setVaultPromptConfirm(!hasCredentialsVault);
    setVaultPromptOpen(true);
  };

  const handleVaultPromptSubmit = (
    masterPassword: string,
    _confirmPassword: string | null
  ) => {
    setVaultPromptOpen(false);
    const mode = vaultPromptMode;
    setVaultPromptMode(null);
    if (mode === "generate" && pendingCredentials) {
      if (Array.isArray(pendingCredentials.targets) && pendingCredentials.targets.length > 0) {
        void (async () => {
          if (!workspaceId || !masterPassword) return;
          setCredentialsBusy(true);
          setCredentialsError(null);
          setCredentialsStatus(null);
          try {
            for (const target of pendingCredentials.targets || []) {
              try {
                await postCredentialsRequest(
                  target.targetRoles,
                  pendingCredentials.force,
                  pendingCredentials.setValues,
                  masterPassword,
                  target.alias
                );
              } catch (err: any) {
                throw new Error(`${target.alias}: ${toUserError(err, "credential generation failed")}`);
              }
            }
            setWorkspaceMasterPassword(workspaceId, masterPassword);
            const updatedTargets = pendingCredentials.targets.length;
            setCredentialsStatus(`Credentials generated for ${updatedTargets} device target(s).`);
            await refreshFiles(workspaceId);
          } catch (err: any) {
            setCredentialsError(toUserError(err, "credential generation failed"));
          } finally {
            setCredentialsBusy(false);
          }
        })();
        setPendingCredentials(null);
        return;
      }
      void postCredentials(
        pendingCredentials.roles,
        pendingCredentials.force,
        pendingCredentials.setValues,
        masterPassword,
        pendingCredentials.alias
      );
      setPendingCredentials(null);
      return;
    }
    if (mode === "vault-reset") {
      void (async () => {
        if (!workspaceId) return;
        setCredentialsBusy(true);
        setCredentialsError(null);
        setCredentialsStatus(null);
        try {
          const res = await fetch(
            `${baseUrl}/api/workspaces/${workspaceId}/vault/reset-password`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ master_password: masterPassword }),
            }
          );
          if (!res.ok) {
            let message = `HTTP ${res.status}`;
            try {
              const data = await res.json();
              if (data?.detail) message = data.detail;
            } catch {
              // ignore
            }
            throw new Error(message);
          }
          const data = await res.json();
          const updatedValues = Number(data?.updated_values ?? 0);
          const updatedFiles = Number(data?.updated_files ?? 0);
          setWorkspaceMasterPassword(workspaceId, masterPassword);
          setCredentialsStatus(
            `Vault password reset (${updatedValues} values in ${updatedFiles} files).`
          );
          await refreshFiles(workspaceId);
        } catch (err: any) {
          setCredentialsError(toUserError(err, "failed to reset vault password"));
        } finally {
          setCredentialsBusy(false);
        }
      })();
    }
  };

  const submitMasterChange = async () => {
    if (!workspaceId) return;
    setMasterChangeBusy(true);
    setMasterChangeError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/vault/master-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            current_master_password:
              masterChangeMode === "reset" ? masterChangeValues.current : undefined,
            new_master_password: masterChangeValues.next,
            new_master_password_confirm: masterChangeValues.confirm,
          }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      setMasterChangeOpen(false);
      setMasterChangeValues({ current: "", next: "", confirm: "" });
      setWorkspaceMasterPassword(workspaceId, masterChangeValues.next);
      setCredentialsStatus(
        masterChangeMode === "set"
          ? "Master password set."
          : "Master password reset."
      );
    } catch (err: any) {
      setMasterChangeError(toUserError(err, "failed to change master password"));
    } finally {
      setMasterChangeBusy(false);
    }
  };

  const resetVaultPassword = () => {
    if (!workspaceId || credentialsBusy) return;
    setCredentialsError(null);
    setCredentialsStatus(null);
    setVaultPromptMode("vault-reset");
    setVaultPromptConfirm(false);
    setVaultPromptOpen(true);
  };

  const submitKeyPassphraseChange = async () => {
    if (!workspaceId || !keyPassphraseModal) return;
    setKeyPassphraseBusy(true);
    setKeyPassphraseError(null);
    try {
      const res = await fetch(
        `${baseUrl}/api/workspaces/${workspaceId}/ssh-keys/change-passphrase`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alias: keyPassphraseModal.alias,
            master_password: keyPassphraseValues.master,
            new_passphrase: keyPassphraseValues.next,
            new_passphrase_confirm: keyPassphraseValues.confirm,
          }),
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      setKeyPassphraseModal(null);
      setKeyPassphraseValues({ master: "", next: "", confirm: "" });
    } catch (err: any) {
      setKeyPassphraseError(toUserError(err, "failed to change passphrase"));
    } finally {
      setKeyPassphraseBusy(false);
    }
  };

  const openVaultValueModal = (mode: "show" | "change", block: any) => {
    setEditorMenu(null);
    setVaultValueInputs({ master: "", next: "", confirm: "" });
    setVaultValueModal({ mode, block, loading: false, plaintext: "" });
  };

  const submitVaultValue = async () => {
    if (!workspaceId || !vaultValueModal) return;
    const lines = editorValue.split("\n");
    const vaultText = extractVaultText(lines, vaultValueModal.block);
    if (!vaultText) {
      setVaultValueModal({
        ...vaultValueModal,
        error: "No vault block found.",
        loading: false,
      });
      return;
    }
    if (!vaultValueInputs.master) {
      setVaultValueModal({
        ...vaultValueModal,
        error: "Master password is required.",
        loading: false,
      });
      return;
    }

    if (vaultValueModal.mode === "change") {
      if (!vaultValueInputs.next || !vaultValueInputs.confirm) {
        setVaultValueModal({
          ...vaultValueModal,
          error: "Enter the new value twice.",
          loading: false,
        });
        return;
      }
      if (vaultValueInputs.next !== vaultValueInputs.confirm) {
        setVaultValueModal({
          ...vaultValueModal,
          error: "Values do not match.",
          loading: false,
        });
        return;
      }
    }

    setVaultValueModal({ ...vaultValueModal, loading: true, error: null });
    try {
      if (vaultValueModal.mode === "show") {
        const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/vault/decrypt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            master_password: vaultValueInputs.master,
            vault_text: vaultText,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(text || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setWorkspaceMasterPassword(workspaceId, vaultValueInputs.master);
        setVaultValueModal({
          ...vaultValueModal,
          plaintext: String(data?.plaintext ?? ""),
          loading: false,
        });
        return;
      }

      const res = await fetch(`${baseUrl}/api/workspaces/${workspaceId}/vault/encrypt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          master_password: vaultValueInputs.master,
          plaintext: vaultValueInputs.next,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setWorkspaceMasterPassword(workspaceId, vaultValueInputs.master);
      const nextContent = replaceVaultBlock(
        lines,
        vaultValueModal.block,
        String(data?.vault_text ?? "")
      );
      setEditorValue(nextContent);
      setEditorDirty(true);
      setVaultValueModal(null);
    } catch (err: any) {
      setVaultValueModal({
        ...vaultValueModal,
        loading: false,
        error: toUserError(err, "vault operation failed"),
      });
    }
  };

  return {
    postCredentials,
    generateCredentials,
    resetVaultPassword,
    handleVaultPromptSubmit,
    submitMasterChange,
    submitKeyPassphraseChange,
    openVaultValueModal,
    submitVaultValue,
  };
}
