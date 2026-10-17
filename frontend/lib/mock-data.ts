export type PaymentRequest = {
    id: string;
    concept: string;
    clientName: string;
    amountMon: string;
    status: "pending" | "paid";
};

export const mockRequests: PaymentRequest[] = [
    {
        id: "1",
        concept: "Diseño de logo",
        clientName: "Laura",
        amountMon: "0.5",
        status: "pending",
    },
    {
        id: "2",
        concept: "Asesoría",
        clientName: "Carlos",
        amountMon: "0.2",
        status: "paid",
    },
    {
        id: "3",
        concept: "Desarrollo web",
        clientName: "Andrea",
        amountMon: "1",
        status: "pending",
    },
];