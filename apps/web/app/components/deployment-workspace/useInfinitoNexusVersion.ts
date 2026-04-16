import { useCallback, useEffect, useState } from "react";

import { parseApiError } from "./helpers";

type VersionOption = { value: string; label: string };

type UseInfinitoNexusVersionParams = {
  baseUrl: string;
  workspaceId: string | null;
};

type UseInfinitoNexusVersionResult = {
  infinitoNexusVersion: string;
  infinitoNexusVersionOptions: VersionOption[];
  infinitoNexusVersionBusy: boolean;
  infinitoNexusVersionError: string | null;
  handleInfinitoNexusVersionChange: (value: string) => Promise<void>;
};

export function useInfinitoNexusVersion({
  baseUrl,
  workspaceId,
}: UseInfinitoNexusVersionParams): UseInfinitoNexusVersionResult {
  const [infinitoNexusVersion, setInfinitoNexusVersion] = useState("latest");
  const [infinitoNexusVersionOptions, setInfinitoNexusVersionOptions] = useState<
    VersionOption[]
  >([{ value: "latest", label: "latest" }]);
  const [infinitoNexusVersionLoading, setInfinitoNexusVersionLoading] =
    useState(false);
  const [infinitoNexusVersionSaving, setInfinitoNexusVersionSaving] =
    useState(false);
  const [infinitoNexusVersionError, setInfinitoNexusVersionError] = useState<
    string | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    const loadVersions = async () => {
      setInfinitoNexusVersionLoading(true);
      setInfinitoNexusVersionError(null);
      try {
        const res = await fetch(`${baseUrl}/api/infinito-nexus/versions`, {
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(await parseApiError(res));
        }
        const data = await res.json();
        const nextOptions: VersionOption[] = Array.isArray(data?.versions)
          ? data.versions
              .map((entry: any) => ({
                value: String(entry?.value || "").trim(),
                label: String(entry?.label || entry?.value || "").trim(),
              }))
              .filter(
                (entry: VersionOption) =>
                  entry.value.length > 0 && entry.label.length > 0
              )
          : [];
        const normalized =
          nextOptions.length > 0
            ? nextOptions
            : [{ value: "latest", label: "latest" }];
        if (cancelled) return;
        setInfinitoNexusVersionOptions(normalized);
        setInfinitoNexusVersion((prev) =>
          normalized.some((entry) => entry.value === prev)
            ? prev
            : String(data?.default_version || "latest").trim() || "latest"
        );
      } catch (err: any) {
        if (cancelled) return;
        setInfinitoNexusVersionOptions([{ value: "latest", label: "latest" }]);
        setInfinitoNexusVersion((prev) => prev || "latest");
        setInfinitoNexusVersionError(
          err?.message ?? "Failed to load Infinito.Nexus versions."
        );
      } finally {
        if (!cancelled) {
          setInfinitoNexusVersionLoading(false);
        }
      }
    };
    void loadVersions();
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  useEffect(() => {
    if (!workspaceId) {
      setInfinitoNexusVersion("latest");
      setInfinitoNexusVersionError(null);
      return;
    }
    let cancelled = false;
    const loadWorkspaceVersion = async () => {
      setInfinitoNexusVersionSaving(true);
      setInfinitoNexusVersionError(null);
      try {
        const res = await fetch(
          `${baseUrl}/api/workspaces/${workspaceId}/runtime-settings`,
          { cache: "no-store" }
        );
        if (!res.ok) {
          throw new Error(await parseApiError(res));
        }
        const data = await res.json();
        const nextValue =
          String(data?.infinito_nexus_version || "").trim() || "latest";
        if (!cancelled) {
          setInfinitoNexusVersion(nextValue);
        }
      } catch (err: any) {
        if (!cancelled) {
          setInfinitoNexusVersion("latest");
          setInfinitoNexusVersionError(
            err?.message ?? "Failed to load Infinito.Nexus version."
          );
        }
      } finally {
        if (!cancelled) {
          setInfinitoNexusVersionSaving(false);
        }
      }
    };
    void loadWorkspaceVersion();
    return () => {
      cancelled = true;
    };
  }, [baseUrl, workspaceId]);

  const handleInfinitoNexusVersionChange = useCallback(
    async (value: string) => {
      const normalized = String(value || "").trim() || "latest";
      const previous = infinitoNexusVersion;
      setInfinitoNexusVersion(normalized);
      setInfinitoNexusVersionError(null);
      if (!workspaceId) return;
      setInfinitoNexusVersionSaving(true);
      try {
        const res = await fetch(
          `${baseUrl}/api/workspaces/${workspaceId}/runtime-settings`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ infinito_nexus_version: normalized }),
          }
        );
        if (!res.ok) {
          throw new Error(await parseApiError(res));
        }
        const data = await res.json();
        setInfinitoNexusVersion(
          String(data?.infinito_nexus_version || "").trim() || normalized
        );
      } catch (err: any) {
        setInfinitoNexusVersion(previous);
        setInfinitoNexusVersionError(
          err?.message ?? "Failed to save Infinito.Nexus version."
        );
      } finally {
        setInfinitoNexusVersionSaving(false);
      }
    },
    [baseUrl, infinitoNexusVersion, workspaceId]
  );

  const infinitoNexusVersionBusy =
    infinitoNexusVersionLoading || infinitoNexusVersionSaving;

  return {
    infinitoNexusVersion,
    infinitoNexusVersionOptions,
    infinitoNexusVersionBusy,
    infinitoNexusVersionError,
    handleInfinitoNexusVersionChange,
  };
}
