import http from "./http";

export interface Client {
  client_code: string;
  client_name: string;
  client_add1?: string;
  client_add2?: string;
  client_add3?: string;
  client_city?: string;
  client_state?: string;
  client_country?: string;
  client_zip?: string;
  client_contact_person?: string;
  client_email?: string;
  client_contact_no?: string;
  active_flag: "Y" | "N";
  created_by: string;
  created_at: string;
  updated_by?: string;
  updated_at: string;
}

export interface ClientCreate extends Partial<Client> {
  client_code: string;
  client_name: string;
}
export type ClientUpdate = Partial<
  Omit<Client, "client_code" | "created_by" | "created_at" | "updated_by" | "updated_at">
>;

export type ClientUpdatePayload = ClientUpdate & { expected_updated_at: string | null };

export interface ClientStatusUpdatePayload {
  active: "Y" | "N";
  expected_updated_at: string | null;
}

export interface ClientSuggestion {
  client_code: string;
  client_name: string;
  client_city?: string;
  client_state?: string;
  client_country?: string;
  client_contact_person?: string;
  client_email?: string;
  client_contact_no?: string;
}

export interface ClientListResponse {
  items: Client[];
  total: number;
}

export interface ClientNameCheckResponse {
  exists: boolean;
  client_code?: string;
  client_name?: string;
}

export const fetchClients = (params: {
  q?: string;
  city?: string;
  state?: string;
  active?: "Y" | "N";
  limit?: number;
  offset?: number;
}) => http.get<ClientListResponse>("/clients", { params }).then((r) => r.data);

export const getClient = (code: string) =>
  http.get<Client>(`/clients/${encodeURIComponent(code)}`).then((r) => r.data);

export const createClient = (data: ClientCreate) =>
  http.post<Client>("/clients", data).then((r) => r.data);

export const updateClient = (code: string, data: ClientUpdatePayload) =>
  http.put<Client>(`/clients/${encodeURIComponent(code)}`, data).then((r) => r.data);

export const setClientStatus = (code: string, payload: ClientStatusUpdatePayload) =>
  http.patch<{ ok: boolean }>(`/clients/${encodeURIComponent(code)}/status`, payload).then((r) => r.data);

export const checkClientName = (name: string, exclude_code?: string) =>
   http
    .get<ClientNameCheckResponse>("/clients/check-name", { params: { name, exclude_code } })
    .then((r) => r.data);

export const searchClientSuggestions = (
  params: { q: string; limit?: number },
  signal?: AbortSignal,
) => http.get<ClientSuggestion[]>("/clients/search", { params, signal }).then((r) => r.data);