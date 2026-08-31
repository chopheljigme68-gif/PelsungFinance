"use client";

import { useState, type FormEvent } from "react";
import { RouteGuard } from "@/components/shell/route-guard";
import { ModuleHero, PanelHeader } from "@/components/ui/primitives";
import { api } from "@/lib/api";
import { timestamp } from "@/lib/format";
import { APP_ROLES, roleDescriptions, roleLabels } from "@/lib/permissions";
import { useApp } from "@/providers/app-provider";
import type { AccountingData, AppRole, ManagedUser } from "@/types";

const roleOptions = APP_ROLES.map((role) => ({
  value: role,
  label: roleLabels[role],
  permissions: roleDescriptions[role],
}));

export default function UsersPage() {
  return <RouteGuard permission="manage_users">{(data) => <UserManagement data={data} />}</RouteGuard>;
}

function UserManagement({ data }: { data: AccountingData }) {
  const { fiscalYear, run } = useApp();
  const currentUserId = data.currentUser.id;

  const [registering, setRegistering] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [username, setUsername] = useState("");
  const [cid, setCid] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [designation, setDesignation] = useState("");
  const [role, setRole] = useState<AppRole>("agency_user");

  const resetEditor = () => {
    setUsername("");
    setCid("");
    setDisplayName("");
    setDesignation("");
    setRole("agency_user");
    setEditingUser(null);
    setRegistering(false);
  };

  const openRegistration = () => {
    resetEditor();
    setRegistering(true);
  };

  const editUser = (managedUser: ManagedUser) => {
    setUsername(managedUser.username);
    setCid(managedUser.cid ?? "");
    setDisplayName(managedUser.displayName);
    setDesignation(managedUser.designation);
    setRole(managedUser.role);
    setEditingUser(managedUser);
    setRegistering(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const payload = { fiscalYear, username, cid, displayName, designation, role };
    const saved = await run(
      () => (editingUser ? api.updateUser(editingUser.id, payload) : api.createUser(payload)),
      editingUser
        ? `${displayName}'s user details were updated.`
        : `User created. The user ID and temporary password were emailed to ${username}.`,
    );
    if (saved) resetEditor();
  };

  const deleteUser = async (managedUser: ManagedUser) => {
    const confirmed = window.confirm(
      `Delete ${managedUser.displayName} (${managedUser.username})?\n\nTheir sign-in access and active sessions will be revoked immediately. Existing vouchers and audit records will keep their name.`,
    );
    if (!confirmed) return;
    await run(
      () => api.deleteUser(managedUser.id),
      `${managedUser.displayName} was deleted. Access was revoked and accounting history was preserved.`,
    );
  };

  const resendInvitation = async (managedUser: ManagedUser) => {
    const confirmed = window.confirm(
      `Send a new temporary password to ${managedUser.username}?\n\nAny previous password for this user will stop working.`,
    );
    if (!confirmed) return;
    await run(
      () => api.resendInvitation(managedUser.id, fiscalYear),
      `A new temporary password was emailed to ${managedUser.username}.`,
    );
  };

  return (
    <>
      <ModuleHero
        eyebrow="Administration"
        title="User Management"
        description="Create users and assign one of the four controlled finance roles."
        actions={
          <button className="secondary-button" onClick={registering ? resetEditor : openRegistration}>
            {registering ? "Cancel" : "＋ Register user"}
          </button>
        }
      />

      <section className="role-matrix">
        {roleOptions.map((option) => (
          <article key={option.value}>
            <span>ROLE</span>
            <strong>{option.label}</strong>
            <p>{option.permissions}</p>
          </article>
        ))}
      </section>

      {registering && (
        <form className="panel admin-form" onSubmit={submit}>
          <PanelHeader
            title={editingUser ? "Edit user" : "Register a user"}
            subtitle={
              editingUser
                ? "Update the user's identity, designation and access role"
                : "Sign-in details will be generated and emailed automatically"
            }
          />
          <div className="form-grid">
            <label>
              Full name
              <input
                maxLength={120}
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                required
              />
            </label>
            <label>
              Designation
              <input
                maxLength={120}
                value={designation}
                onChange={(event) => setDesignation(event.target.value)}
                placeholder="e.g. Finance Officer"
                required
              />
            </label>
            <label>
              CID
              <input
                inputMode="numeric"
                minLength={11}
                maxLength={11}
                pattern="[0-9]{11}"
                value={cid}
                onChange={(event) => setCid(event.target.value.replace(/\D/g, "").slice(0, 11))}
                placeholder="11-digit CID"
                required
              />
            </label>
            <label>
              Email username (user ID)
              <input
                type="email"
                maxLength={254}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="email"
                placeholder="name@example.com"
                required
              />
            </label>
            <label>
              Role
              <select
                value={role}
                disabled={editingUser?.id === currentUserId}
                onChange={(event) => setRole(event.target.value as AppRole)}
              >
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="policy-note">
            {editingUser
              ? "Changes apply to future sign-ins and will also update the designation displayed on vouchers."
              : "A secure temporary password will be generated on the server and emailed to the user. They must change it at first sign-in."}
          </p>
          <button className="primary-button">{editingUser ? "Save changes" : "Create user"}</button>
        </form>
      )}

      <section className="panel register-panel">
        <div className="register-toolbar">
          <div>
            <h3>Users and responsibilities</h3>
            <p>
              Pending invitations can be retried without deleting the user. Deleting a user revokes access while
              preserving vouchers and audit history.
            </p>
          </div>
          <span className="fy-chip">{data.users.filter((user) => user.active).length} ACTIVE USERS</span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Designation</th>
                <th>CID</th>
                <th>User ID (email)</th>
                <th>Role</th>
                <th>Password</th>
                <th>Invitation</th>
                <th>Last sign-in</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.users.map((managedUser) => (
                <tr className={managedUser.deletedAt ? "deleted-user-row" : ""} key={managedUser.id}>
                  <td>
                    <strong>{managedUser.displayName}</strong>
                    {managedUser.id === currentUserId && <small>Signed-in account</small>}
                  </td>
                  <td>{managedUser.designation}</td>
                  <td>{managedUser.cid ?? "—"}</td>
                  <td>{managedUser.username}</td>
                  <td>
                    <select
                      aria-label={`Role for ${managedUser.displayName}`}
                      value={managedUser.role}
                      disabled={managedUser.id === currentUserId || Boolean(managedUser.deletedAt)}
                      onChange={(event) =>
                        void run(
                          () => api.updateUserRole(managedUser.id, event.target.value, fiscalYear),
                          `${managedUser.displayName}'s role was updated.`,
                        )
                      }
                    >
                      {roleOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {managedUser.deletedAt ? (
                      "Revoked"
                    ) : managedUser.mustChangePassword ? (
                      <span className="status status-pending">
                        <i />
                        Change required
                      </span>
                    ) : (
                      "Current"
                    )}
                  </td>
                  <td>
                    {managedUser.invitationSentAt ? (
                      <span className="status status-approved">
                        <i />
                        Email sent
                      </span>
                    ) : managedUser.mustChangePassword ? (
                      <span className="status status-pending">
                        <i />
                        Invitation pending
                      </span>
                    ) : (
                      "Existing account"
                    )}
                  </td>
                  <td>{managedUser.lastLoginAt ? timestamp(managedUser.lastLoginAt) : "Never"}</td>
                  <td>
                    {managedUser.deletedAt ? (
                      <>
                        <span className="status status-rejected">
                          <i />
                          Deleted
                        </span>
                        <small>{new Date(managedUser.deletedAt).toLocaleDateString("en-BT")}</small>
                      </>
                    ) : (
                      <span className={`status ${managedUser.active ? "status-approved" : "status-rejected"}`}>
                        <i />
                        {managedUser.active ? "Active" : "Inactive"}
                      </span>
                    )}
                  </td>
                  <td>
                    {managedUser.deletedAt ? (
                      "—"
                    ) : (
                      <div className="table-actions">
                        {managedUser.mustChangePassword && (
                          <button
                            type="button"
                            className="resend-invitation-button"
                            onClick={() => void resendInvitation(managedUser)}
                          >
                            {managedUser.invitationSentAt ? "Resend invitation" : "Send invitation"}
                          </button>
                        )}
                        <button type="button" className="edit-user-button" onClick={() => editUser(managedUser)}>
                          Edit
                        </button>
                        {managedUser.id === currentUserId ? (
                          <span className="protected-account">Protected</span>
                        ) : (
                          <button
                            type="button"
                            className="delete-user-button"
                            onClick={() => void deleteUser(managedUser)}
                          >
                            Delete user
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
