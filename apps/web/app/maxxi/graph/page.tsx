"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, Card, Empty, ErrorNote, Loading, PageHeader, SectionTitle } from "../ui";
import { StepBrief } from "../flow";
import { metaForType, resolveThemeColors } from "@/app/components/crm/graph/graph-meta";

const G6Canvas = dynamic(
	() => import("@/app/components/crm/graph/g6-canvas").then((module) => module.G6Canvas),
	{
		ssr: false,
		loading: () => (
			<div className="flex h-full items-center justify-center text-sm" style={{ color: "var(--maxxi-muted)" }}>
				Caricamento grafo…
			</div>
		),
	},
);

type GraphNode = { id: string; label: string; type: string };
type GraphEdge = { source: string; target: string; type: string; rel: string };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean };
type GraphDetail = {
	id: string;
	type: string;
	label: string;
	fields: Array<{ name: string; type: string; value: string | null }>;
	relations: Array<{ id: string; label: string; type: string; edgeType: string; direction: "out" | "in" }>;
};

const GRAPH_TYPES = ["person", "organization", "catalog", "interest", "source"] as const;

export default function MaxxiGraphPage() {
	return (
		<Suspense fallback={<Loading label="Caricamento del grafo…" />}>
			<GraphInner />
		</Suspense>
	);
}

function GraphInner() {
	const params = useSearchParams();
	const initialFocus = params.get("focus") ?? null;
	const initialNode = params.get("node") ?? null;
	const initialDepth = Number(params.get("depth") ?? "2");

	const [data, setData] = useState<GraphData>({ nodes: [], edges: [], truncated: false });
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	// Type buttons are visibility toggles, not an exclusive filter. Visitors
	// start hidden in both views so the object graph stays legible; the focus
	// person is always kept even when the person type is hidden.
	const [hiddenTypes, setHiddenTypes] = useState<string[]>(
		initialFocus && !initialFocus.startsWith("P-") ? [] : ["person"],
	);
	const [search, setSearch] = useState("");
	const [focus] = useState<string | null>(initialFocus);
	const [depth] = useState<number>(Number.isFinite(initialDepth) ? initialDepth : 2);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [detail, setDetail] = useState<GraphDetail | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);
	const [detailError, setDetailError] = useState<string | null>(null);

	const theme = useMemo(
		() =>
			typeof document === "undefined"
				? resolveThemeColors()
				: resolveThemeColors(document.querySelector('[data-workspace-theme="maxxi"]')),
		[],
	);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const query = new URLSearchParams();
			if (focus) {query.set("focus", focus);query.set("depth", String(depth));}
			const qs = query.toString();
			const res = await fetch(`/api/maxxi/graph${qs ? `?${qs}` : ""}`, { cache: "no-store" });
			const body = (await res.json()) as GraphData & { error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setData(body);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Caricamento del grafo fallito.");
		} finally {
			setLoading(false);
		}
	}, [focus, depth]);

	useEffect(() => {
		void load();
	}, [load]);

	const selectNode = useCallback(async (id: string) => {
		setSelectedId(id);
		setDetailLoading(true);
		setDetailError(null);
		setDetail(null);
		try {
			const res = await fetch(`/api/maxxi/graph/node?id=${encodeURIComponent(id)}`, { cache: "no-store" });
			const body = (await res.json()) as GraphDetail & { error?: string };
			if (!res.ok) {throw new Error(body.error ?? `HTTP ${res.status}`);}
			setDetail(body);
		} catch (err) {
			setDetailError(err instanceof Error ? err.message : "Dettaglio non disponibile.");
		} finally {
			setDetailLoading(false);
		}
	}, []);

	useEffect(() => {
		if (initialNode) {void selectNode(initialNode);}
	}, [initialNode, selectNode]);

	const displayed = useMemo<GraphData>(() => {
		let nodes = data.nodes.filter((node) => node.id === focus || !hiddenTypes.includes(node.type));
		let edges = data.edges.filter(
			(edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target),
		);

		// In a visitor view, drop objects that were only reachable through
		// another (hidden) visitor. Central views keep the object catalogue
		// even when its nodes are not connected to each other.
		if (focus && hiddenTypes.includes("person")) {
			const connected = new Set<string>([focus]);
			for (const edge of edges) {
				connected.add(edge.source);
				connected.add(edge.target);
			}
			nodes = nodes.filter((node) => connected.has(node.id));
			edges = edges.filter((edge) => connected.has(edge.source) && connected.has(edge.target));
		}

		const needle = search.trim().toLowerCase();
		if (needle) {
			const matching = new Set(
				nodes.filter((node) => node.label.toLowerCase().includes(needle)).map((node) => node.id),
			);
			nodes = nodes.filter((node) => matching.has(node.id));
			edges = edges.filter((edge) => matching.has(edge.source) && matching.has(edge.target));
		}

		return { nodes, edges, truncated: data.truncated };
	}, [data, focus, hiddenTypes, search]);

	const toggleType = (type: string) => {
		setHiddenTypes((current) =>
			current.includes(type) ? current.filter((value) => value !== type) : [...current, type],
		);
	};

	const availableTypes = useMemo(() => {
		const present = new Set(data.nodes.map((node) => node.type));
		return GRAPH_TYPES.filter((type) => present.has(type));
	}, [data.nodes]);

	const focusLabel = focus
		? data.nodes.find((node) => node.id === focus)?.label ?? focus
		: null;
	const focusIsPerson = focus
		? data.nodes.find((node) => node.id === focus)?.type === "person"
		: false;
	const peopleHidden = hiddenTypes.includes("person");
	const filtersDirty = search.trim().length > 0 || hiddenTypes.join(",") !== "person";

	const panel = selectedId ? (
		<GraphPanel
			detail={detail}
			loading={detailLoading}
			error={detailError}
			onClose={() => { setSelectedId(null); setDetail(null); }}
			onSelect={selectNode}
		/>
	) : null;

	return (
		<div className="space-y-5">
			<PageHeader
				eyebrow="Pubblico / Grafo relazioni"
				title="Grafo delle relazioni"
				subtitle={
					focusIsPerson
						? "Vista centrata sul visitatore: oggetti e relazioni dirette. Gli altri visitatori restano nascosti per non affollare la vista."
						: "Vista oggetti: organizzazioni, mostre, interessi e fonti. I visitatori sono nascosti finché non attivi Persone o cerchi un nome."
				}
				actions={
					focusLabel ? (
						<>
							<Badge tone="neutral">Vista: {focusLabel}</Badge>
							<Link href="/maxxi/graph" className="maxxi-secondary-action">
								Mostra tutto
							</Link>
						</>
					) : undefined
				}
			/>

			<StepBrief
				step={1}
				question="Quali relazioni spiegano il suo coinvolgimento?"
				evidence={`${displayed.nodes.length} nodi · ${displayed.edges.length} relazioni${focusIsPerson ? " · altri visitatori nascosti" : ""} · ${displayed.edges.filter((edge) => edge.rel === "duplicate").length} possibili duplicati (segnalazioni, non fusioni)`}
				next={{ href: "/maxxi/segments", label: "Calcola il segmento" }}
			/>

			<Card className="p-0">
				<div className="border-b p-4" style={{ borderColor: "var(--maxxi-line)" }}>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<SectionTitle
							hint={
								displayed.edges.length === 0
									? "Clicca un oggetto per i dettagli e per esplorare le persone collegate. Il layout è statico."
									: "Clicca un nodo per i dettagli · trascina per spostare · scroll per zoom. Il layout è statico: i nodi non si muovono da soli."
							}
						>
							Esplora le connessioni
						</SectionTitle>
						<input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Filtra per nome…"
							aria-label="Filtra i nodi del grafo per nome"
							className="maxxi-input max-w-xs"
						/>
					</div>
					<p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
						{peopleHidden
							? focusIsPerson
								? "Vista sul visitatore: sono visibili solo gli oggetti collegati. Attiva Persone per includere gli altri visitatori."
								: "Vista oggetti: i visitatori sono nascosti. Attiva Persone o cerca un nome per esplorarli."
							: "Vista completa: sono inclusi anche i visitatori."}
					</p>
					<div className="mt-2 flex flex-wrap items-center gap-2">
						{availableTypes.map((type) => {
							const meta = metaForType(type);
							const active = !hiddenTypes.includes(type);
							return (
								<button
									key={type}
									type="button"
									aria-pressed={active}
									onClick={() => toggleType(type)}
									className="min-h-[36px] border px-2.5 text-[11.5px] font-semibold"
									style={{
										borderColor: active ? "var(--maxxi-ink)" : "var(--maxxi-line-strong)",
										background: active ? "var(--maxxi-ink)" : "var(--maxxi-paper)",
										color: active ? "#ffffff" : "var(--maxxi-ink)",
									}}
								>
									<span aria-hidden="true" className="mr-1.5" style={{ color: active ? "#ffffff" : meta.color }}>
										{meta.icon}
									</span>
									{meta.label}
								</button>
							);
						})}
						{filtersDirty && (
							<button
								type="button"
								onClick={() => { setHiddenTypes(["person"]); setSearch(""); }}
								className="maxxi-secondary-action"
							>
								Reimposta vista
							</button>
						)}
					</div>
				</div>

				<div className="flex h-[600px] min-h-0 flex-col md:flex-row">
					<div className="relative min-h-[360px] min-w-0 flex-1">
						{loading ? (
							<div className="flex h-full items-center justify-center">
								<Loading label="Caricamento del grafo…" />
							</div>
						) : error ? (
							<div className="p-4"><ErrorNote>{error}</ErrorNote></div>
						) : displayed.nodes.length === 0 ? (
							<Empty>Nessun nodo corrisponde ai filtri correnti.</Empty>
						) : (
							<G6Canvas
								key={displayed.edges.length === 0 ? "grid" : "force"}
								nodes={displayed.nodes}
								edges={displayed.edges}
								theme={theme}
								onNodeClick={selectNode}
								stableLayout
								layoutMode={displayed.edges.length === 0 ? "grid" : "force"}
							/>
						)}
						{!loading && !error && displayed.nodes.length > 0 && (
							<div
								className="pointer-events-none absolute bottom-2 left-3 text-[11px]"
								style={{ color: "var(--maxxi-muted)" }}
							>
								{displayed.nodes.length} nodi · {displayed.edges.length} relazioni
								{displayed.truncated ? " · vista ridotta" : ""}
							</div>
						)}
					</div>

					{panel && (
						<aside
							className="hidden w-80 shrink-0 overflow-y-auto border-l p-4 md:block"
							style={{ borderColor: "var(--maxxi-line)" }}
							aria-label="Dettaglio nodo"
						>
							{panel}
						</aside>
					)}
				</div>
			</Card>

			{panel && (
				<div className="md:hidden">
					<Card>{panel}</Card>
				</div>
			)}

			<p className="text-[11.5px] leading-relaxed" style={{ color: "var(--maxxi-muted)" }}>
				Il grafo legge solo il database demo isolato. Un arco “Possibile duplicato” indica
				una revisione da fare, non un’identità confermata. Le note private infopoint non sono
				esposte.
			</p>
		</div>
	);
}

function GraphPanel({
	detail,
	loading,
	error,
	onClose,
	onSelect,
}: {
	detail: GraphDetail | null;
	loading: boolean;
	error: string | null;
	onClose: () => void;
	onSelect: (id: string) => void;
}) {
	if (loading) {return <Loading label="Caricamento dettaglio…" />;}
	if (error) {return <ErrorNote>{error}</ErrorNote>;}
	if (!detail) {return <Empty>Nessun dettaglio.</Empty>;}
	const meta = metaForType(detail.type);

	return (
		<div className="space-y-4">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="maxxi-eyebrow">{meta.label}</p>
					<h2 className="maxxi-section-title mt-1 break-words">{detail.label}</h2>
				</div>
				<button type="button" onClick={onClose} className="maxxi-secondary-action" aria-label="Chiudi dettaglio">
					Chiudi
				</button>
			</div>

			{detail.type === "person" ? (
				<Link href={`/maxxi/people?id=${encodeURIComponent(detail.id)}`} className="maxxi-primary-action">
					Apri profilo 360
				</Link>
			) : (
				<Link
					href={`/maxxi/graph?focus=${encodeURIComponent(detail.id)}&depth=2`}
					className="maxxi-primary-action"
				>
					Esplora le persone collegate
				</Link>
			)}

			<dl className="divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
				{detail.fields.map((field) => (
					<div key={field.name} className="py-2">
						<dt className="maxxi-eyebrow">{field.name}</dt>
						<dd className="mt-1 break-words text-[12.5px]">
							{field.value == null || field.value === "" ? (
								<span style={{ color: "var(--maxxi-muted)" }}>—</span>
							) : field.type === "json" ? (
								<pre className="whitespace-pre-wrap text-[11.5px]" style={{ color: "var(--maxxi-muted)" }}>
									{prettyJson(field.value)}
								</pre>
							) : (
								field.value
							)}
						</dd>
					</div>
				))}
			</dl>

			<div>
				<p className="maxxi-eyebrow">Relazioni · {detail.relations.length}</p>
				{detail.relations.length === 0 ? (
					<Empty>Nessuna relazione.</Empty>
				) : (
					<ul className="mt-2 divide-y" style={{ borderColor: "var(--maxxi-line)" }}>
						{detail.relations.map((relation) => (
							<li key={`${relation.direction}:${relation.edgeType}:${relation.id}`}>
								<button
									type="button"
									onClick={() => onSelect(relation.id)}
									className="flex w-full items-center gap-2 py-2 text-left text-[12px] hover:opacity-75"
								>
									<span aria-hidden="true">{relation.direction === "out" ? "→" : "←"}</span>
									<span className="min-w-0 flex-1 truncate">{relation.label}</span>
									<span className="shrink-0 text-[10.5px]" style={{ color: "var(--maxxi-muted)" }}>
										{relation.edgeType}
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

function prettyJson(value: string): string {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) ? parsed.map((row) => `• ${String(row)}`).join("\n") : JSON.stringify(parsed, null, 2);
	} catch {
		return value;
	}
}
