"use client";

import { useCallback, useEffect, useState } from "react";
import {
  inviteMember,
  listMembers,
  removeMember,
  transferOwnership,
} from "../lib/members-api";
import type { WorkspaceMember, WorkspaceMembers } from "./workspace-panel/types";

type Props = {
  workspaceId: string;
  // Whether the current user is the owner of this workspace. Drives the
  // visibility of invite / remove / transfer actions.
  isOwner: boolean;
};

export default function MembersPanel({ workspaceId, isOwner }: Props) {
  const [data, setData] = useState<WorkspaceMembers | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listMembers(workspaceId));
    } catch (e) {
      setError(`Failed to load members: ${(e as Error).message}`);
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const guard = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    await guard(async () => {
      await inviteMember(workspaceId, inviteEmail.trim());
      setInviteEmail("");
    });
  };

  if (!data) {
    return (
      <div data-testid="members-panel-loading">
        {error || "Loading members…"}
      </div>
    );
  }

  return (
    <div data-testid="members-panel">
      {error && (
        <div role="alert" style={{ color: "#b00", marginBottom: 8 }}>
          {error}
        </div>
      )}

      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px" }}>
        <MemberRow
          member={data.owner}
          tag="Owner"
          actions={null}
          testId="members-row-owner"
        />
        {data.members.map((m) => (
          <MemberRow
            key={`m-${m.user_id ?? m.email}`}
            member={m}
            tag="Member"
            testId={`members-row-claimed-${m.user_id ?? m.email ?? "unknown"}`}
            actions={
              isOwner && (
                <>
                  <button
                    disabled={busy || !m.user_id}
                    onClick={() =>
                      guard(() =>
                        transferOwnership(workspaceId, m.user_id || "")
                      )
                    }
                    aria-label="Make owner"
                  >
                    Make owner
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      guard(() =>
                        removeMember(
                          workspaceId,
                          m.user_id || m.email || ""
                        )
                      )
                    }
                    aria-label="Remove member"
                  >
                    Remove
                  </button>
                </>
              )
            }
          />
        ))}
        {data.pending.map((m) => (
          <MemberRow
            key={`p-${m.email}`}
            member={m}
            tag="Pending"
            testId={`members-row-pending-${m.email ?? "unknown"}`}
            actions={
              isOwner && (
                <button
                  disabled={busy}
                  onClick={() =>
                    guard(() => removeMember(workspaceId, m.email || ""))
                  }
                  aria-label="Cancel invite"
                >
                  Cancel
                </button>
              )
            }
          />
        ))}
      </ul>

      {isOwner && (
        <form onSubmit={onInvite} data-testid="members-invite-form">
          <label>
            Invite by email{" "}
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="user@example.com"
              data-testid="members-invite-input"
            />
          </label>
          <button type="submit" disabled={busy} data-testid="members-invite-submit">
            Invite
          </button>
        </form>
      )}
    </div>
  );
}

function MemberRow({
  member,
  tag,
  actions,
  testId,
}: {
  member: WorkspaceMember;
  tag: string;
  actions: React.ReactNode;
  testId?: string;
}) {
  return (
    <li
      data-testid={testId}
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        padding: "6px 0",
        borderBottom: "1px solid #eee",
      }}
    >
      <span
        style={{
          fontSize: 12,
          background: "#eef",
          padding: "2px 6px",
          borderRadius: 3,
        }}
      >
        {tag}
      </span>
      <span style={{ flex: 1 }}>
        {member.email || member.user_id || "(unknown)"}
        {member.user_id && member.email ? (
          <small style={{ color: "#888", marginLeft: 6 }}>
            ({member.user_id})
          </small>
        ) : null}
      </span>
      <span style={{ display: "flex", gap: 4 }}>{actions}</span>
    </li>
  );
}
