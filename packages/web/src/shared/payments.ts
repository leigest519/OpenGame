export interface CreditPack {
  id: string;
  credits: number;
  amountMinor: number;
}
export interface CreditOrder {
  id: string;
  packId: string;
  credits: number;
  amountMinor: number;
  status: string;
  createdAt: string;
  approvalUrl: string | null;
}
export interface PaymentAccount {
  enabled: boolean;
  sandbox: boolean;
  packs: CreditPack[];
  orders: CreditOrder[];
}
