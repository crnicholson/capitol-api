export interface Asset {
  name: string;
  ticker: string | null;
  type: string;
  typeDescription: string;
}

export interface Transaction {
  type: string;
  description: string;
  category: string;
  tradeDate: string;
  notificationDate: string;
  filingDate: string;
  amount: string;
  amountMin: number | null;
  amountMax: number | null;
  capitalGains: boolean | null;
  price: number | null;
}

export interface Filing {
  docId: string;
  year: number;
  pdfUrl: string;
}

export interface Term {
  type: string;
  start: string;
  end: string;
  state: string;
  district?: number;
  party: string;
}

export interface Person {
  bioguideId: string;
  name: string;
  firstName: string;
  lastName: string;
  state: string;
  district: number;
  party: string;
  phone: string;
  gender: string;
  birthday: string;
  terms: Term[];
}

export interface Trade {
  id: string;
  owner: string;
  asset: Asset;
  transaction: Transaction;
  filing: Filing;
  person: Person;
}

export interface TradesResponse {
  total: number;
  offset: number;
  limit: number | null;
  returned: number;
  trades: Trade[];
}

export interface StatusResponse {
  fetchRunning: boolean;
  fetchProgress: string;
  fetchError: string | null;
  fetchStartedAt: string | null;
  cacheStatus: "none" | "in_progress" | "complete";
  cacheLastUpdated: string | null;
  cacheYears: number[];
  totalTrades: number;
  config: {
    yearsStart: number;
    yearsEnd: number;
    cacheRefreshHours: number;
  };
}

export interface QueryParams {
  state?: string;
  party?: string;
  person?: string;
  ticker?: string;
  type?: string;
  category?: string;
  from?: string;
  to?: string;
  sort?: string;
  order?: string;
  limit?: string;
  offset?: string;
  recent?: string;
}
