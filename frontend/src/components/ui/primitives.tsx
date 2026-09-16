"use client";

import Image from "next/image";
import type { ReactNode } from "react";
import type { VoucherStatus } from "@/types";
import { Portal } from "./portal";

export function PelsungLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      className={`pelsung-logo ${className}`.trim()}
      src="/pelsung-logo.png"
      width={768}
      height={768}
      priority
      unoptimized
      alt="Pelsung emblem"
    />
  );
}

/** Crisp white plus for icon-only action buttons (see `.icon-button`). */
export function PlusIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
    </svg>
  );
}

export function Empty({ message }: { message: string }) {
  return (
    <div className="empty-state">
      <span>✓</span>
      <strong>{message}</strong>
      <small>There is nothing requiring attention in this section.</small>
    </div>
  );
}

export function Status({ status }: { status: VoucherStatus }) {
  return (
    <span className={`status status-${status.toLowerCase()}`}>
      <i />
      {status}
    </span>
  );
}

export function Kpi({
  label,
  value,
  note,
  tone,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  tone: string;
  icon: string;
}) {
  return (
    <article className="kpi-card">
      <span className={`kpi-icon ${tone}`}>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value}</strong>
        <em>{note}</em>
      </div>
    </article>
  );
}

export function PanelHeader({
  title,
  subtitle,
  action,
  onAction,
}: {
  title: string;
  subtitle: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <header className="panel-header">
      <div>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </div>
      {action && (
        <button type="button" onClick={onAction}>
          {action} →
        </button>
      )}
    </header>
  );
}

export function ModuleHero({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <section className="module-hero">
      <div>
        <span className="eyebrow dark">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {actions && <div className="module-hero-actions">{actions}</div>}
    </section>
  );
}

/** Shared modal frame: click the backdrop to dismiss unless it is forced. */
export function ModalShell({
  children,
  onClose,
  className = "",
  dismissible = true,
}: {
  children: ReactNode;
  onClose: () => void;
  className?: string;
  dismissible?: boolean;
}) {
  return (
    <Portal>
      <div
        className={`modal-backdrop ${className}`.trim()}
        role="presentation"
        onMouseDown={(event) => {
          if (dismissible && event.currentTarget === event.target) onClose();
        }}
      >
        {children}
      </div>
    </Portal>
  );
}
