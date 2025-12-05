import http from "./http";

// Campaign Types
export interface Campaign {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  based_on: string;
  rfm_mode?: string;
  recency_op?: string;
  recency_min?: number;
  recency_max?: number;
  frequency_op?: string;
  frequency_min?: number;
  frequency_max?: number;
  monetary_op?: string;
  monetary_min?: number;
  monetary_max?: number;
  r_score?: number[] | Record<string, unknown>;
  f_score?: number[] | Record<string, unknown>;
  m_score?: number[] | Record<string, unknown>;
  rfm_segments?: string[] | Record<string, unknown>;
  branch?: string[] | Record<string, unknown>;
  city?: string[] | Record<string, unknown>;
  state?: string[] | Record<string, unknown>;
  birthday_start?: string;
  birthday_end?: string;
  anniversary_start?: string;
  anniversary_end?: string;
  purchase_type?: string;
  purchase_brand?: string[] | Record<string, unknown>;
  section?: string[] | Record<string, unknown>;
  product?: string[] | Record<string, unknown>;
  model?: string[] | Record<string, unknown>;
  item?: string[] | Record<string, unknown>;
  value_threshold?: number;
  created_at: string;
  updated_at: string;
}

export interface CampaignCreate {
  name: string;
  start_date: string;
  end_date: string;
  based_on: string;
  rfm_mode?: string;
  recency_op?: string;
  recency_min?: number;
  recency_max?: number;
  frequency_op?: string;
  frequency_min?: number;
  frequency_max?: number;
  monetary_op?: string;
  monetary_min?: number;
  monetary_max?: number;
  r_score?: number[];
  f_score?: number[];
  m_score?: number[];
  rfm_segments?: string[];
  branch?: string[];
  city?: string[];
  state?: string[];
  birthday_start?: string;
  birthday_end?: string;
  anniversary_start?: string;
  anniversary_end?: string;
  purchase_type?: string;
  purchase_brand?: string[];
  section?: string[];
  product?: string[];
  model?: string[];
  item?: string[];
  value_threshold?: number;
}

export interface CampaignUpdate extends CampaignCreate {
  expected_updated_at?: string;
}

// API Functions
export const getCampaigns = () =>
  http.get<Campaign[]>("/campaign").then((r) => r.data);

export const getCampaign = (id: number) =>
  http.get<Campaign>(`/campaign/${id}`).then((r) => r.data);

export const createCampaign = (payload: CampaignCreate) =>
  http.post<Campaign>("/campaign/createCampaign", payload).then((r) => r.data);

export const updateCampaign = (id: number, payload: CampaignUpdate) =>
  http.put<Campaign>(`/campaign/${id}`, payload).then((r) => r.data);

// Campaign Options
export interface CampaignOptions {
  r_scores: number[];
  f_scores: number[];
  m_scores: number[];
  rfm_segments: string[];
  branches: string[];
  branch_city_map: Record<string, string[]>;
  branch_state_map: Record<string, string[]>;
  brands: string[];
  sections: string[];
  products: string[];
  models: string[];
  items: string[];
  brand_hierarchy: Array<{
    brand: string;
    section: string;
    product: string;
    model: string;
    item: string;
  }>;
}

export const getCampaignOptions = () =>
  http.get<CampaignOptions>("/campaign/options").then((r) => r.data);

// Campaign Count
export interface CampaignCountRequest {
  name?: string;
  start_date?: string;
  end_date?: string;
  based_on?: string;
  recency_op?: string;
  recency_min?: number;
  recency_max?: number;
  frequency_op?: string;
  frequency_min?: number;
  frequency_max?: number;
  monetary_op?: string;
  monetary_min?: number;
  monetary_max?: number;
  r_score?: number[];
  f_score?: number[];
  m_score?: number[];
  rfm_segments?: string[];
  branch?: string[];
  city?: string[];
  state?: string[];
  birthday_start?: string;
  birthday_end?: string;
  anniversary_start?: string;
  anniversary_end?: string;
  purchase_type?: string;
  purchase_brand?: string[];
  section?: string[];
  product?: string[];
  model?: string[];
  item?: string[];
  value_threshold?: number;
  rfm_mode?: string;
}

export interface CampaignCountResponse {
  total_customers: number;
  shortlisted_customers: number;
}

export const countCampaignCustomers = (payload: CampaignCountRequest) =>
  http.post<CampaignCountResponse>("/campaign/run/count", payload).then((r) => r.data);
