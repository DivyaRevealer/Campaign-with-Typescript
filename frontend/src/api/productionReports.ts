import http from "./http";

const BASE = "/production-reports";

export interface ProductionReportItem {
  description: string;
  part_no?: string | null;
  prod_date?: string | null;
  prod_qty: string;
}

export interface ProductionReportResponse {
  so_no: string;
  items: ProductionReportItem[];
}

export async function getProductionReport(soNo: string): Promise<ProductionReportResponse> {
  const { data } = await http.get<ProductionReportResponse>(
    `${BASE}/${encodeURIComponent(soNo)}`,
  );
  return data;
}