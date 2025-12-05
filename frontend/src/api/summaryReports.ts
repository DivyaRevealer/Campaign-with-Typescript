import http from "./http";

const BASE = "/summary-reports";

export interface SummaryReportItem {
  description: string;
  part_no?: string | null;
  ordered_qty: string;
  delivered_qty: string;
  yet_to_deliver_qty: string;
  stock_in_hand_qty: string;
  yet_to_produce_qty: string;
}

export interface SummaryReportResponse {
  so_no: string;
  items: SummaryReportItem[];
}

export async function getSummaryReport(soNo: string): Promise<SummaryReportResponse> {
  const { data } = await http.get<SummaryReportResponse>(
    `${BASE}/${encodeURIComponent(soNo)}`,
  );
  return data;
}