import http from "./http";

export interface Company {
  comp_code: string;
  comp_name: string;
  comp_add1?: string;
  comp_add2?: string;
  comp_add3?: string;
  comp_city?: string;
  comp_state?: string;
  comp_country?: string;
  comp_zip?: string;
  comp_contact_person?: string;
  comp_email?: string;
  comp_contact_no?: string;
  active_flag: "Y" | "N";
  created_by: string;
  created_at: string;
  updated_by?: string;
  updated_at?: string;
}

export interface CompanyCreate extends Partial<Company> {
  comp_code: string;
  comp_name: string;
}

export type CompanyUpdate = Partial<
  Omit<Company, "comp_code" | "created_by" | "created_at" | "updated_by" | "updated_at">
>;

export type CompanyUpdatePayload = CompanyUpdate & { expected_updated_at: string | null };

export interface CompanyStatusUpdatePayload {
  active: "Y" | "N";
  expected_updated_at: string | null;
}

export interface CompanySuggestion {
  comp_code: string;
  comp_name: string;
  comp_city?: string;
  comp_state?: string;
  comp_country?: string;
  comp_contact_person?: string;
  comp_email?: string;
  comp_contact_no?: string;
}

export interface CompanyListResponse {
  items: Company[];
  total: number;
}

export interface CompanyNameCheckResponse {
  exists: boolean;
  comp_code?: string;
  comp_name?: string;
}

export const fetchCompanies = (params: {
  q?: string;
  city?: string;
  state?: string;
  active?: "Y" | "N";
  limit?: number;
  offset?: number;
}) => http.get<CompanyListResponse>("/companies", { params }).then((r) => r.data);

export const getCompany = (code: string) =>
  http.get<Company>(`/companies/${encodeURIComponent(code)}`).then((r) => r.data);

export const createCompany = (data: CompanyCreate) =>
  http.post<Company>("/companies", data).then((r) => r.data);

export const updateCompany = (code: string, data: CompanyUpdatePayload) =>
  http.put<Company>(`/companies/${encodeURIComponent(code)}`, data).then((r) => r.data);

export const setCompanyStatus = (code: string, payload: CompanyStatusUpdatePayload) =>
  http.patch<{ ok: boolean }>(`/companies/${encodeURIComponent(code)}/status`, payload).then((r) => r.data);

export const checkCompanyName = (name: string, exclude_code?: string) =>
  http
    .get<CompanyNameCheckResponse>("/companies/check-name", { params: { name, exclude_code } })
    .then((r) => r.data);

export const searchCompanies = (
  params: { q: string; limit?: number },
  signal?: AbortSignal,
) => http.get<CompanySuggestion[]>("/companies/search", { params, signal }).then((r) => r.data);