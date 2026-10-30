import type { ReactNode } from "react";
import { MaxxiShell } from "./shell";

export const dynamic = "force-dynamic";

export default function MaxxiLayout({ children }: { children: ReactNode }) {
	return <MaxxiShell>{children}</MaxxiShell>;
}
