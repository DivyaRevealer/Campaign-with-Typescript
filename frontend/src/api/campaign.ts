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

export interface CampaignUploadResponse {
  message: string;
  count: number;
}

export const uploadCampaignContacts = (campaignId: number, file: File): Promise<CampaignUploadResponse> => {
  const formData = new FormData();
  formData.append("file", file);
  return http.post<CampaignUploadResponse>(`/campaign/${campaignId}/upload`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  }).then((r) => r.data);
};

export const downloadCampaignContacts = async (campaignId: number, campaignName: string): Promise<void> => {
  try {
    const response = await http.get(`/campaign/${campaignId}/upload/download`, {
      responseType: "blob",
    });
    
    // Create blob URL and trigger download
    const blob = response.data instanceof Blob 
      ? response.data 
      : new Blob([response.data], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    
    // Generate safe filename from campaign name
    const safeName = campaignName.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || `campaign_${campaignId}`;
    link.download = `${safeName}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  } catch (error: any) {
    // If it's a blob error (404, etc.), try to read the error message
    if (error.response && error.response.data instanceof Blob) {
      const text = await error.response.data.text();
      try {
        const errorData = JSON.parse(text);
        throw new Error(errorData.detail || errorData.message || "Failed to download file");
      } catch {
        throw new Error("Failed to download file. Please ensure contacts are uploaded for this campaign.");
      }
    }
    throw error;
  }
};

// Campaign Dashboard Types
export interface CampaignKPIData {
  total_customer: number;
  unit_per_transaction: number;
  customer_spending: number;
  days_to_return: number;
  retention_rate: number;
}

export interface ChartDataPoint {
  name: string;
  value: number;
  count?: number;
}

export interface SegmentDataPoint {
  name: string;
  value: number;
  fill?: string;
}

export interface DaysToReturnBucketData {
  name: string;
  count: number;
}

export interface FiscalYearData {
  year: string;
  new_customer_percent: number;
  old_customer_percent: number;
}

export interface CampaignDashboardFilters {
  state?: string[];  // Multi-select support
  city?: string[];  // Multi-select support
  store?: string[];  // Multi-select support
  segment_map?: string;
  r_value_bucket?: string;
  f_value_bucket?: string;
  m_value_bucket?: string;
}

export interface FilterOptions {
  states: string[];
  cities: string[];
  stores: string[];
  segment_maps: string[];
  r_value_buckets: string[];
  f_value_buckets: string[];
  m_value_buckets: string[];
}

export interface CampaignDashboardOut {
  kpi: CampaignKPIData;
  r_score_data: ChartDataPoint[];
  f_score_data: ChartDataPoint[];
  m_score_data: ChartDataPoint[];
  r_value_bucket_data: ChartDataPoint[];
  visits_data: ChartDataPoint[];
  value_data: ChartDataPoint[];
  segment_data: SegmentDataPoint[];
  days_to_return_bucket_data: DaysToReturnBucketData[];
  fiscal_year_data: FiscalYearData[];
}

// Campaign Dashboard API Functions
export const getCampaignDashboard = (
  filters?: CampaignDashboardFilters,
  signal?: AbortSignal,
): Promise<CampaignDashboardOut> => {
  const params = new URLSearchParams();
  if (filters?.state) params.append("state", filters.state);
  if (filters?.city) params.append("city", filters.city);
  if (filters?.store) params.append("store", filters.store);
  if (filters?.segment_map) params.append("segment_map", filters.segment_map);
  if (filters?.r_value_bucket) params.append("r_value_bucket", filters.r_value_bucket);
  if (filters?.f_value_bucket) params.append("f_value_bucket", filters.f_value_bucket);
  if (filters?.m_value_bucket) params.append("m_value_bucket", filters.m_value_bucket);
  
  const queryString = params.toString();
  const url = `/campaign/dashboard${queryString ? `?${queryString}` : ""}`;
  // Timeout: 180 seconds (3 minutes) to match backend KPI query timeout
  // First request may take 30-180 seconds for large datasets, subsequent requests are <100ms from cache
  return http.get<CampaignDashboardOut>(url, { timeout: 180000, signal }).then((r) => r.data);
};

export const getCampaignDashboardFilters = (
  state?: string[],
  city?: string[],
  store?: string[]
): Promise<FilterOptions> => {
  // Add timeout of 10 seconds for filter options (should be fast)
  // Supports multi-select: append each value separately
  const params = new URLSearchParams();
  if (state && Array.isArray(state)) {
    state.forEach(s => {
      if (s && s !== "All") params.append("state", s);
    });
  } else if (state && state !== "All") {
    params.append("state", state);
  }
  if (city && Array.isArray(city)) {
    city.forEach(c => {
      if (c && c !== "All") params.append("city", c);
    });
  } else if (city && city !== "All") {
    params.append("city", city);
  }
  if (store && Array.isArray(store)) {
    store.forEach(s => {
      if (s && s !== "All") params.append("store", s);
    });
  } else if (store && store !== "All") {
    params.append("store", store);
  }
  const queryString = params.toString();
  const url = `/campaign/dashboard/filters${queryString ? `?${queryString}` : ""}`;
  console.log(`🟢 [API] Calling: ${url}`);
  return http.get<FilterOptions>(url, { timeout: 30000 }).then((r) => {
    console.log(`✅ [API] Response received for: ${url}`);
    return r.data;
  });
};

export const getStoreInfo = (store: string): Promise<{ state: string | null; city: string | null }> => {
  return http.get<{ state: string | null; city: string | null }>(`/campaign/dashboard/filters/store-info?store=${encodeURIComponent(store)}`, { timeout: 10000 }).then((r) => r.data);
};

export const getStoresInfo = (stores: string[]): Promise<{ states: string[]; cities: string[] }> => {
  const params = new URLSearchParams();
  stores.forEach(s => {
    if (s && s !== "All") params.append("stores", s);
  });
  return http.get<{ states: string[]; cities: string[] }>(`/campaign/dashboard/filters/stores-info?${params.toString()}`, { timeout: 10000 }).then((r) => r.data);
};