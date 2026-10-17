"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { PaymentRequest } from "@/lib/mock-data";

export default function PaymentRequestDetail({
                                                 request,
                                             }: {
    request: PaymentRequest;
}) {
    const [paymentUrl, setPaymentUrl] = useState("");
    const [message, setMessage] = useState("");

    useEffect(() => {
        setPaymentUrl(
            `${window.location.origin}/pay/${encodeURIComponent(request.id)}`
        );
    }, [request.id]);

    async function copyLink() {
        try {
            await navigator.clipboard.writeText(paymentUrl);
            setMessage("Enlace copiado.");
        } catch {
            setMessage("No se pudo copiar. Selecciona y copia el enlace.");
        }
    }

    return (
        <main className="mx-auto max-w-xl space-y-6 px-4 py-8">
            <Link href="/" className="text-violet-500">
                ← Volver al dashboard
            </Link>

            <h1 className="text-3xl font-bold">Detalle del cobro</h1>

            <p className="rounded-lg bg-amber-100 p-3 text-amber-900">
                Demo: este cobro no está registrado en blockchain.
            </p>

            <section className="space-y-3 rounded-xl border p-5">
                <h2 className="text-xl font-semibold">{request.concept}</h2>
                <p>Cliente: {request.clientName}</p>
                <p className="text-3xl font-bold">{request.amountMon} MON</p>
                <p>
                    Estado demo:{" "}
                    {request.status === "paid" ? "Pagado" : "Pendiente"}
                </p>
            </section>

            {paymentUrl && (
                <section className="space-y-4 rounded-xl border p-5">
                    <h2 className="text-xl font-semibold">Compartir cobro</h2>

                    <div className="inline-block rounded-lg bg-white p-4">
                        <QRCodeSVG
                            value={paymentUrl}
                            size={200}
                            title="Enlace al cobro de demostración"
                        />
                    </div>

                    <input
                        aria-label="Enlace al cobro"
                        readOnly
                        value={paymentUrl}
                        className="w-full rounded-lg border p-3 text-slate-900"
                        onFocus={(event) => event.currentTarget.select()}
                    />

                    <div className="flex flex-wrap gap-3">
                        <button
                            type="button"
                            onClick={copyLink}
                            className="rounded-lg bg-violet-600 px-4 py-2 text-white"
                        >
                            Copiar enlace
                        </button>

                        <Link
                            href={`/pay/${request.id}`}
                            className="rounded-lg border px-4 py-2"
                        >
                            Ver página de pago
                        </Link>
                    </div>

                    <p role="status">{message}</p>
                </section>
            )}
        </main>
    );
}