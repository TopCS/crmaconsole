"use client";

import { useEffect, useState } from "react";

export type Me = { username: string; roles: string[] };

export function useMe(): { me: Me | null; loading: boolean } {
	const [me, setMe] = useState<Me | null>(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const res = await fetch("/api/auth/me", { cache: "no-store" });
				if (!res.ok) {return;}
				const body = (await res.json()) as { username?: string; roles?: string[] };
				if (!cancelled && body.username) {
					setMe({ username: body.username, roles: body.roles ?? [] });
				}
			} catch {
				// leave me null
			} finally {
				if (!cancelled) {setLoading(false);}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return { me, loading };
}

export function hasRole(me: Me | null, role: string): boolean {
	return me?.roles.includes(role) === true;
}
