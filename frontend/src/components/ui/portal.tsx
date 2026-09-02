"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into <body>, outside the app shell.
 *
 * Print modals must live here: the print stylesheet hides `.workspace` to strip
 * the app chrome, and a modal nested inside `.workspace` would be hidden with
 * it — producing a blank print. Portalling to <body> keeps the modal a sibling
 * of the workspace, so it survives and prints on its own.
 *
 * Mounts only after hydration (document is not available during SSR).
 */
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}