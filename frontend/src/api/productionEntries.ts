import http from "./http";

const BASE = "/production-entries";

export interface ProductionEntryItemPayload {
  line_no: number;
  prod_qty: number;
  production_date?: string | null;
}

export interface ProductionEntryPayload {
  so_voucher_no: string;
  production_date: string;
  items: ProductionEntryItemPayload[];
  expected_updated_at?: string | null;
}

export interface ProductionEntryItemResponse {
  line_no: number;
  description: string;
  part_no?: string | null;
  due_on?: string | null;
  so_qty: number;
  prod_qty: number;
  bal_qty: number;
}

export interface ProductionEntryHeaderResponse {
  so_voucher_no: string;
  so_voucher_date: string;
  company_code: string;
  company_name: string;
  client_code: string;
  client_name: string;
  production_date?: string | null;
  created_by?: string | null;
  created_at?: string | null;
  updated_by?: string | null;
  updated_at?: string | null;
}

export interface ProductionEntryResponse {
  header: ProductionEntryHeaderResponse;
  items: ProductionEntryItemResponse[];
  has_entry: boolean;
}

export interface ProductionEntryValidationItemPayload {
  line_no: number | null;
  description?: string | null;
  part_no?: string | null;
  prod_qty: number;
  production_date?: string | null;
  previous_prod_qty?: number;
}

export interface ProductionEntryValidationPayload {
  so_voucher_no: string;
  items: ProductionEntryValidationItemPayload[];
}

export interface ProductionEntryValidationItemResult {
  line_no?: number | null;
  description?: string | null;
  part_no?: string | null;
  error?: string | null;
}

export interface ProductionEntryValidationResponse {
  valid: boolean;
  items: ProductionEntryValidationItemResult[];
}

export async function getProductionEntry(so_voucher_no: string): Promise<ProductionEntryResponse> {
  const { data } = await http.get<ProductionEntryResponse>(
    `${BASE}/${encodeURIComponent(so_voucher_no)}`,
  );
  return data;
}

export async function createProductionEntry(
  payload: ProductionEntryPayload,
): Promise<ProductionEntryResponse> {
  const { data } = await http.post<ProductionEntryResponse>(BASE, payload);
  return data;
}

export async function updateProductionEntry(
  so_voucher_no: string,
  payload: ProductionEntryPayload,
): Promise<ProductionEntryResponse> {
  const { data } = await http.put<ProductionEntryResponse>(
    `${BASE}/${encodeURIComponent(so_voucher_no)}`,
    payload,
  );
  return data;
}

export async function validateProductionEntry(
  payload: ProductionEntryValidationPayload,
): Promise<ProductionEntryValidationResponse> {
  const { data } = await http.post<ProductionEntryValidationResponse>(
    `${BASE}/validate`,
    payload,
  );
  return data;
}

export async function checkProductionEntry(so_voucher_no: string): Promise<boolean> {
  const { data } = await http.get<{ exists?: boolean }>(`${BASE}/check`, {
    params: { so_voucher_no },
  });
  return Boolean(data?.exists);
}