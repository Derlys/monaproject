import { notFound } from "next/navigation";
import PaymentRequestDetail from "@/app/components/PaymentRequestDetail";
import { mockRequests } from "@/lib/mock-data";

export default function RequestDetailPage({
                                              params,
                                          }: {
    params: { id: string };
}) {
    const request = mockRequests.find((item) => item.id === params.id);

    if (!request) {
        notFound();
    }

    return <PaymentRequestDetail request={request} />;
}