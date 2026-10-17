"use client";

import Link from "next/link";
import { useState } from "react";
import {
    mockRequests,
    type PaymentRequest,
} from "@/lib/mock-data";

type Filter = "all" | PaymentRequest["status"];

export default function PaymentDashboard() {
    const [filter, setFilter] = useState<Filter>("all");

    const requests = mockRequests.filter(
        (request) => filter === "all" || request.status === filter
    );

    return (
        <main className="mx-auto max-w-5xl space-y-6 px-4 py-8">
            <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold">MonPago</h1>
                    <p className="text-slate-500">Administra tus cobros en MON</p>
                </div>

                <Link
                    href="/requests/new"
                    className="rounded-lg bg-violet-600 px-4 py-2 text-white"
                >
                    Crear cobro
                </Link>
            </div>

            <p className="rounded-lg bg-amber-100 p-3 text-amber-900">
                Modo demo: estos cobros son datos de prueba.
            </p>

            <div className="flex flex-wrap gap-2">
                {(
                    [
                        ["all", "Todos"],
                        ["pending", "Pendientes"],
                        ["paid", "Pagados"],
                    ] as const
                ).map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        aria-pressed={filter === value}
                        onClick={() => setFilter(value)}
                        className={`rounded-lg border px-4 py-2 ${
                            filter === value
                                ? "bg-violet-600 text-white"
                                : "border-slate-400"
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {requests.length === 0 ? (
                <p>No hay cobros para este filtro.</p>
            ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                    {requests.map((request) => (
                        <article
                            key={request.id}
                            className="space-y-3 rounded-xl border border-slate-300 p-5"
                        >
                            <h2 className="text-xl font-semibold">
                                {request.concept}
                            </h2>

                            <p>Cliente: {request.clientName}</p>
                            <p className="text-2xl font-bold">
                                {request.amountMon} MON
                            </p>

                            <span
                                className={`inline-block rounded-full px-3 py-1 text-sm ${
                                    request.status === "paid"
                                        ? "bg-green-100 text-green-800"
                                        : "bg-amber-100 text-amber-800"
                                }`}
                            >
                {request.status === "paid" ? "Pagado" : "Pendiente"}
              </span>

                            <Link
                                href={`/requests/${request.id}`}
                                className="block font-medium text-violet-500 hover:underline"
                            >
                                Ver detalle →
                            </Link>
                        </article>
                    ))}
                </div>
            )}
        </main>
    );
}