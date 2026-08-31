import type { ReactNode } from "react";
import { AppShell } from "@/components/shell/app-shell";

/** Every signed-in screen renders inside the workspace frame. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
