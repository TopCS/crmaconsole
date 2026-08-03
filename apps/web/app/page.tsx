import { redirect } from "next/navigation";
import { isOnboardingComplete } from "@/lib/crm-a-console-state";
import { WorkspaceShell } from "./workspace/workspace-content";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default function Home() {
  if (!isOnboardingComplete()) {
    redirect("/onboarding");
  }
  return <WorkspaceShell />;
}
