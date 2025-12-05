import http from "./http";

const BASE = "/delivery-entries";

export interface DeliveryEntryItemPayload {
  line_no: number;
  dely_qty: number;
  dely_date?: string | null;
}

export interface DeliveryEntryPayload {
  so_voucher_no: string;
  dely_date: string;
  items: DeliveryEntryItemPayload[];
  expected_updated_at?: string | null;
}

export interface DeliveryEntryItemResponse {
  line_no: number;
  description: string;
  part_no?: string | null;
  due_on?: string | null;
  so_qty: number;
  dely_qty: number;
  stock_qty: number;
}

export interface DeliveryEntryHeaderResponse {
  so_voucher_no: string;
  so_voucher_date: string;
  company_code: string;
  company_name: string;
  client_code: string;
  client_name: string;
  dely_date?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
}

export interface DeliveryEntryResponse {
  header: DeliveryEntryHeaderResponse;
  items: DeliveryEntryItemResponse[];
  has_entry: boolean;
}

export interface DeliveryEntryValidationItemPayload {
  line_no: number | null;
  description?: string | null;
  part_no?: string | null;
  dely_qty: number;
  dely_date?: string | null;
  previous_dely_qty?: number;
}

export interface DeliveryEntryValidationPayload {
  so_voucher_no: string;
  items: DeliveryEntryValidationItemPayload[];
}

export interface DeliveryEntryValidationItemResult {
  line_no?: number | null;
  description?: string | null;
  part_no?: string | null;
  error?: string | null;
}

export interface DeliveryEntryValidationResponse {
  valid: boolean;
  items: DeliveryEntryValidationItemResult[];
}

export async function getDeliveryEntry(so_voucher_no: string): Promise<DeliveryEntryResponse> {
  const { data } = await http.get<DeliveryEntryResponse>(
    `${BASE}/${encodeURIComponent(so_voucher_no)}`,
  );
  return data;
}

export async function createDeliveryEntry(
  payload: DeliveryEntryPayload,
): Promise<DeliveryEntryResponse> {
  const { data } = await http.post<DeliveryEntryResponse>(BASE, payload);
  return data;
}

export async function updateDeliveryEntry(
  so_voucher_no: string,
  payload: DeliveryEntryPayload,
): Promise<DeliveryEntryResponse> {
  const { data } = await http.put<DeliveryEntryResponse>(
    `${BASE}/${encodeURIComponent(so_voucher_no)}`,
    payload,
  );
  return data;
}

export async function validateDeliveryEntry(
  payload: DeliveryEntryValidationPayload,
): Promise<DeliveryEntryValidationResponse> {
  const { data } = await http.post<DeliveryEntryValidationResponse>(
    `${BASE}/validate`,
    payload,
  );
  return data;
}

export async function checkDeliveryEntry(so_voucher_no: string): Promise<boolean> {
  const { data } = await http.get<{ exists?: boolean }>(`${BASE}/check`, {
    params: { so_voucher_no },
  });
  return Boolean(data?.exists);
}