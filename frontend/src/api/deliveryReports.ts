import http from "./http";

const BASE = "/delivery-reports";

export interface DeliveryReportItem {
  description: string;
  part_no?: string | null;
  dely_date?: string | null;
  dely_qty: string;
}

export interface DeliveryReportResponse {
  so_no: string;
  items: DeliveryReportItem[];
}

export async function getDeliveryReport(soNo: string): Promise<DeliveryReportResponse> {
  const { data } = await http.get<DeliveryReportResponse>(
    `${BASE}/${encodeURIComponent(soNo)}`,
  );
  return data;
}