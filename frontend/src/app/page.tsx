import { redirect } from "next/navigation";

/** The workspace opens on the dashboard; the shell redirects to sign-in if needed. */
export default function IndexPage() {
  redirect("/dashboard");
}
