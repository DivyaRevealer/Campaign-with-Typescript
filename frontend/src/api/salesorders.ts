
import http from "./http";

const BASE = "/sales-orders";

export interface SalesOrderItemPayload {
  line_no?: number | null;
  description: string;
  part_no: string;
  due_on: string;
  qty: number;
  rate: number;
  per: string;
  disc_pct: number;
  amount: number;
}

export interface SalesOrderHeaderPayload {
  so_voucher_no?: string;
  so_voucher_date: string;
  job_ref_no?: string;
  order_date?: string | null;
  client_po_no: string;
  company_code: string;
  company_name: string;
  client_code: string;
  client_name: string;
  currency: string;
}

export interface SalesOrderPayload {
  header: SalesOrderHeaderPayload;
  items: SalesOrderItemPayload[];
  expected_updated_at?: string | null;
}

export interface SalesOrderItemResponse extends SalesOrderItemPayload {
  line_no: number;
  prod_qty: number;
  dely_qty: number;
  stock_qty: number;
}

export interface SalesOrderHeaderResponse extends SalesOrderHeaderPayload {
  order_date?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
  so_status?: string | null;
}

export interface SalesOrderResponse {
  header: SalesOrderHeaderResponse;
  items: SalesOrderItemResponse[];
}

export interface SalesOrderNumberResponse {
  so_voucher_no: string;
}

export interface SalesOrderCancelResponse {
  so_voucher_no: string;
  status: string;
  message?: string;
}

export interface SalesOrderCancelPayload {
  expected_updated_at?: string | null;
}

export interface SalesOrderUploadItem {
  description?: string;
  part_no?: string | null;
  due_on?: string | null;
  qty?: string | null;
  rate?: string | null;
  per?: string | null;
  disc_pct?: string | null;
}

export interface SalesOrderUploadResponse {
  file_name: string;
  sheet_name: string;
  items: SalesOrderUploadItem[];
}

export interface SalesOrderUploadJsonPayload {
  template: string;
  sheet_name: string;
  rows: Record<string, unknown>[];
}

export interface ScanUploadResponse {
  status: "clean" | "infected";
  detail?: string;
}

export async function getSalesOrder(so_voucher_no: string): Promise<SalesOrderResponse> {
  const { data } = await http.get<SalesOrderResponse>(`${BASE}/${encodeURIComponent(so_voucher_no)}`);
  return data;
}

export async function exportSalesOrder(so_voucher_no: string): Promise<Blob> {
  const response = await http.get<Blob>(
    `${BASE}/${encodeURIComponent(so_voucher_no)}/export`,
    { responseType: "blob" },
  );
  return response.data;
}

export async function createSalesOrder(payload: SalesOrderPayload): Promise<SalesOrderResponse> {
  const { data } = await http.post<SalesOrderResponse>(BASE, payload);
  return data;
}

export async function updateSalesOrder(
  so_voucher_no: string,
  payload: SalesOrderPayload,
): Promise<SalesOrderResponse> {
  const { data } = await http.put<SalesOrderResponse>(
    `${BASE}/${encodeURIComponent(so_voucher_no)}`,
    payload,
  );
  return data;
}

export async function checkSOVoucherNo(so_voucher_no: string): Promise<boolean> {
  const { data } = await http.get<{ exists?: boolean }>(
    `${BASE}/check`,
    { params: { so_voucher_no } },
  );
  return Boolean(data?.exists);
}

export async function getNextSalesOrderNumber(orderDate: string): Promise<SalesOrderNumberResponse> {
  const { data } = await http.get<SalesOrderNumberResponse>(`${BASE}/next-number`, {
    params: { order_date: orderDate },
  });
  return data;
}

export async function cancelSalesOrder(
  so_voucher_no: string,
  payload?: SalesOrderCancelPayload,
): Promise<SalesOrderCancelResponse> {
  const { data } = await http.post<SalesOrderCancelResponse>(
    `${BASE}/${encodeURIComponent(so_voucher_no)}/cancel`,
    payload,
  );
  return data;
}

export async function uploadSalesOrderItems(
  file: File,
  options?: { signal?: AbortSignal },
): Promise<SalesOrderUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await http.post<SalesOrderUploadResponse>(
    `${BASE}/upload-items`,
    formData,
    {
      signal: options?.signal,
    },
  );

  return data;
}

export async function uploadSalesOrderItemsJson(
  payload: SalesOrderUploadJsonPayload,
  options?: { signal?: AbortSignal },
): Promise<SalesOrderUploadResponse> {
  const { data } = await http.post<SalesOrderUploadResponse>(
    `${BASE}/upload-items-json`,
    payload,
    {
      signal: options?.signal,
    },
  );

  return data;
}

export async function scanSalesOrderUpload(
  file: File,
  options?: { signal?: AbortSignal },
): Promise<ScanUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const { data } = await http.post<ScanUploadResponse>(`${BASE}/scan-upload`, formData, {
    signal: options?.signal,
  });

  return data;
}