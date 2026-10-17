"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { parseEther } from "viem";

type Draft = {
    concept: string;
    amountMon: string;
    clientName: string;
    category: string;
};

export default function NewRequestPage() {
    const [draft, setDraft] = useState<Draft | null>(null);
    const [error, setError] = useState("");

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setError("");
        setDraft(null);

        const data = new FormData(event.currentTarget);
        const concept = String(data.get("concept") ?? "").trim();
        const amountMon = String(data.get("amountMon") ?? "").trim();

        try {
            if (!concept) {
                throw new Error("Escribe el concepto del cobro.");
            }

            if (!/^\d+(\.\d{1,18})?$/.test(amountMon)) {
                throw new Error(
                    "Usa un monto válido con punto decimal y hasta 18 decimales."
                );
            }

            if (parseEther(amountMon) <= BigInt(0)) {
                throw new Error("El monto debe ser mayor que cero.");
            }

            setDraft({
                concept,
                amountMon,
                clientName: String(data.get("clientName") ?? "").trim(),
                category: String(data.get("category") ?? "").trim(),
            });
        } catch (err) {
            setError(
                err instanceof Error ? err.message : "Revisa los datos."
            );
        }
    }

    return (
        <main className="mx-auto max-w-xl space-y-6 px-4 py-8">
            <Link href="/" className="text-violet-600">
                ← Volver al dashboard
            </Link>

            <h1 className="text-3xl font-bold">Crear cobro</h1>

            <p className="rounded-lg bg-amber-100 p-3 text-amber-900">
                Modo demo: solo genera una vista previa, no guarda ni envía
                transacciones.
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block">
                    Concepto
                    <input
                        name="concept"
                        required
                        maxLength={200}
                        className="mt-1 w-full rounded-lg border p-3 text-slate-900"
                    />
                </label>

                <label className="block">
                    Monto en MON
                    <input
                        name="amountMon"
                        required
                        inputMode="decimal"
                        placeholder="0.001"
                        className="mt-1 w-full rounded-lg border p-3 text-slate-900"
                    />
                </label>

                <label className="block">
                    Cliente (opcional)
                    <input
                        name="clientName"
                        className="mt-1 w-full rounded-lg border p-3 text-slate-900"
                    />
                </label>

                <label className="block">
                    Categoría (opcional)
                    <input
                        name="category"
                        className="mt-1 w-full rounded-lg border p-3 text-slate-900"
                    />
                </label>

                {error && (
                    <p role="alert" className="text-red-600">
                        {error}
                    </p>
                )}

                <button
                    type="submit"
                    className="rounded-lg bg-violet-600 px-5 py-3 text-white"
                >
                    Ver vista previa
                </button>
            </form>

            {draft && (
                <section
                    aria-live="polite"
                    className="space-y-2 rounded-xl border p-5"
                >
                    <h2 className="text-xl font-bold">Vista previa del cobro</h2>
                    <p>{draft.concept}</p>
                    <p>{draft.amountMon} MON</p>
                    <p>Cliente: {draft.clientName || "Sin especificar"}</p>
                    <p>Categoría: {draft.category || "Sin categoría"}</p>
                    <p className="text-sm text-slate-500">
                        Este cobro todavía no se ha creado.
                    </p>
                </section>
            )}
        </main>
    );
}