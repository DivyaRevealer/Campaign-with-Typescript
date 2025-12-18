import { useState, useEffect, useCallback, useMemo, memo, useRef, type FormEvent } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
  Treemap,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LabelList,
} from "recharts";
import { 
  getCampaignDashboard,
  getCampaignDashboardFilters,
  getStoreInfo,
  type CampaignDashboardFilters, 
  type CampaignKPIData, 
  type ChartDataPoint,
  type SegmentDataPoint,
  type DaysToReturnBucketData,
  type FiscalYearData,
  type FilterOptions,
} from "../../api/campaign";
import { extractApiErrorMessage } from "../../api/errors";
import "../common/adminTheme.css";
import "./CampaignDashboard.css";

// Types
interface DashboardFilters {
  state: string;
  city: string;
  store: string;
  segmentMap: string;
  rValueBucket: string;
  fValueBucket: string;
  mValueBucket: string;
}

// Chart colors matching reference project
const COLORS = [
  '#536d8e', // main tile blue
  '#c8a036', // accent gold
  '#205166', // darker blue
  '#914545', // red-brown
  '#009292', // teal
  '#583f74', // purple
];

// Gradients for pie charts (matching reference project)
const GRADIENTS = [
  { id: "grad1", start: "#536d8e", end: "#914545" },
  { id: "grad2", start: "#c8a036", end: "#ffdb70" },
  { id: "grad3", start: "#205166", end: "#009292" },
  { id: "grad4", start: "#583f74", end: "#8e6ccf" },
  { id: "grad5", start: "#d84a4a", end: "#ffb199" },
  { id: "grad6", start: "#1fa2ff", end: "#12d8fa" }
];

const renderSegmentTreemapContent = (props: any) => {
  const { x, y, width, height, name, value, fill } = props;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const headingSize = Math.max(Math.min(width / 10, 14), 9);
  const valueSize = Math.max(Math.min(width / 14, 12), 9);

  return (
    <g>
      <rect x={x} y={y} width={width} height={height} style={{ fill, stroke: "#fff", strokeWidth: 2 }} />
      <text
        x={centerX}
        y={centerY - 4}
        textAnchor="middle"
        fill="#000"
        stroke="none"
        fontSize={headingSize}
        fontWeight={40}
        style={{ textShadow: "none" }}
      >
        {name}
      </text>
      <text
        x={centerX}
        y={centerY + 16}
        textAnchor="middle"
        fill="#000"
        stroke="none"
        fontSize={valueSize}
        fontWeight={400}
        style={{ textShadow: "none" }}
      >
        {value?.toLocaleString()}
      </text>
    </g>
  );
};




// Lazy Chart Wrapper - Only renders when visible
const LazyChart = memo(({ children, className = "" }: { children: React.ReactNode; className?: string }) => {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" } // Start loading 100px before visible
    );

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {isVisible ? children : <div style={{ height: "300px", display: "flex", alignItems: "center", justifyContent: "center", color: "#999" }}>Loading chart...</div>}
    </div>
  );
});
LazyChart.displayName = "LazyChart";

export default function CampaignDashboard() {
  const [filters, setFilters] = useState<DashboardFilters>({
    state: "All",
    city: "All",
    store: "All",
    segmentMap: "All",
    rValueBucket: "All",
    fValueBucket: "All",
    mValueBucket: "All",
  });
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    states: [],
    cities: [],
    stores: [],
    segment_maps: [],
    r_value_buckets: [],
    f_value_buckets: [],
    m_value_buckets: [],
  });
  const [loading, setLoading] = useState(false);
  const [applyingFilters, setApplyingFilters] = useState(false); // Separate state for filter application
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Initialize with empty/default values - NOT mock data
  // State will be updated from API response
  const [kpiData, setKpiData] = useState<CampaignKPIData>({
    total_customer: 0,
    unit_per_transaction: 0,
    customer_spending: 0,
    days_to_return: 0,
    retention_rate: 0,
  });
  const [rScoreData, setRScoreData] = useState<ChartDataPoint[]>([]);
  const [fScoreData, setFScoreData] = useState<ChartDataPoint[]>([]);
  const [mScoreData, setMScoreData] = useState<ChartDataPoint[]>([]);
  const [rValueBucketData, setRValueBucketData] = useState<ChartDataPoint[]>([]);
  const [visitsData, setVisitsData] = useState<ChartDataPoint[]>([]);
  const [valueData, setValueData] = useState<ChartDataPoint[]>([]);
  const [segmentData, setSegmentData] = useState<SegmentDataPoint[]>([]);
  const [daysToReturnBucketData, setDaysToReturnBucketData] = useState<DaysToReturnBucketData[]>([]);
  const [fiscalYearData, setFiscalYearData] = useState<FiscalYearData[]>([]);
  const [chartsReady, setChartsReady] = useState(false);
  const dashboardRequestRef = useRef<AbortController | null>(null);
  const initialLoadDoneRef = useRef(false); // Track if initial load is complete
  const handleFilterChange = (field: keyof DashboardFilters, value: string) => {
    setFilters((prev) => {
      const updated = { ...prev, [field]: value };
      const currentState = prev.state;
      
      // Reset dependent filters when parent changes
      if (field === "state") {
        // Reset city and store when state changes
        updated.city = "All";
        updated.store = "All";
        
        // Reload cities and stores filtered by selected state
        if (value !== "All") {
          getCampaignDashboardFilters(value)
            .then((options) => {
              setFilterOptions((prevOptions) => ({
                ...prevOptions,
                cities: options.cities,
                stores: options.stores,
              }));
            })
            .catch((err) => {
              console.error("Failed to load filtered options for state:", err);
            });
        } else {
          // Reset to all options when state is "All"
          getCampaignDashboardFilters()
            .then((options) => {
              setFilterOptions((prevOptions) => ({
                ...prevOptions,
                cities: options.cities,
                stores: options.stores,
              }));
            })
            .catch((err) => {
              console.error("Failed to load all filter options:", err);
            });
        }
      } else if (field === "city") {
        // Reset store when city changes
        updated.store = "All";
        
        // Reload stores filtered by selected state and city
        if (value !== "All" && currentState !== "All") {
          getCampaignDashboardFilters(currentState, value)
            .then((options) => {
              setFilterOptions((prevOptions) => ({
                ...prevOptions,
                stores: options.stores,
              }));
            })
            .catch((err) => {
              console.error("Failed to load filtered stores for city:", err);
            });
        } else if (value === "All" && currentState !== "All") {
          // Load all stores for the state when city is reset to "All"
          getCampaignDashboardFilters(currentState)
            .then((options) => {
              setFilterOptions((prevOptions) => ({
                ...prevOptions,
                stores: options.stores,
              }));
            })
            .catch((err) => {
              console.error("Failed to load stores for state:", err);
            });
        } else if (value === "All" && currentState === "All") {
          // Load all stores when both state and city are "All"
          getCampaignDashboardFilters()
            .then((options) => {
              setFilterOptions((prevOptions) => ({
                ...prevOptions,
                stores: options.stores,
              }));
            })
            .catch((err) => {
              console.error("Failed to load all stores:", err);
            });
        }
      } else if (field === "store") {
        // When store is selected, automatically set state and city
        if (value !== "All") {
          getStoreInfo(value)
            .then((storeInfo) => {
              if (storeInfo.state && storeInfo.city) {
                const storeState = storeInfo.state;
                const storeCity = storeInfo.city;
                
                // Update state and city automatically
                setFilters((prevFilters) => ({
                  ...prevFilters,
                  state: storeState,
                  city: storeCity,
                  store: value,
                }));
                
                // Reload filter options for the determined state and city
                getCampaignDashboardFilters(storeState, storeCity)
                  .then((options) => {
                    setFilterOptions((prevOptions) => ({
                      ...prevOptions,
                      cities: options.cities,
                      stores: options.stores,
                    }));
                  })
                  .catch((err) => {
                    console.error("Failed to load filter options for store:", err);
                  });
              } else {
                console.warn(`Store info not found for: ${value}`);
              }
            })
            .catch((err) => {
              console.error("Failed to get store info:", err);
            });
        } else {
          // When store is reset to "All", reload all options
          getCampaignDashboardFilters()
            .then((options) => {
              setFilterOptions((prevOptions) => ({
                ...prevOptions,
                cities: options.cities,
                stores: options.stores,
              }));
            })
            .catch((err) => {
              console.error("Failed to load all filter options:", err);
            });
        }
      }
      
      return updated;
    });
  };

  const loadDashboardData = useCallback(async (filterParams?: CampaignDashboardFilters, isFilterApplication: boolean = false) => {
    setError(null);
    
    // Only set applyingFilters if this is a filter application, not initial load
    if (isFilterApplication) {
      setApplyingFilters(true);
    } else {
      setLoading(true);
    }

    // Cancel any in-flight dashboard request to keep the UI responsive
    dashboardRequestRef.current?.abort();
    const controller = new AbortController();
    dashboardRequestRef.current = controller;
    
    // Log for debugging
    console.log("🔵 [Dashboard] Loading dashboard data with filters:", filterParams || "no filters (initial load)");
    
    // Log the actual API URL that will be called
    const apiUrl = filterParams 
      ? `/campaign/dashboard?${new URLSearchParams({
          ...(filterParams.state && { state: filterParams.state }),
          ...(filterParams.city && { city: filterParams.city }),
          ...(filterParams.store && { store: filterParams.store }),
          ...(filterParams.segment_map && { segment_map: filterParams.segment_map }),
          ...(filterParams.r_value_bucket && { r_value_bucket: filterParams.r_value_bucket }),
          ...(filterParams.f_value_bucket && { f_value_bucket: filterParams.f_value_bucket }),
          ...(filterParams.m_value_bucket && { m_value_bucket: filterParams.m_value_bucket }),
        }).toString()}`
      : "/campaign/dashboard";
    console.log("🔵 [Dashboard] API URL:", apiUrl);

    // Show a progress indicator for long-running requests
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    
    try {
      console.log("🔵 [Dashboard] Making API call to getCampaignDashboard...");
      console.log("🔵 [Dashboard] Note: First request may take 30-180 seconds for large datasets. Subsequent requests will be cached (<1 second).");
      
      // Log progress every 10 seconds for long-running requests
      progressInterval = setInterval(() => {
        console.log("⏳ [Dashboard] Still loading... This may take up to 3 minutes for the first request.");
      }, 10000);
      
      const response = await getCampaignDashboard(filterParams, controller.signal);
      
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
      
      console.log("🔵 [Dashboard] API call completed, response received");
      
      // Comprehensive debug logging to verify API response
      console.log("✅ [Dashboard] API Response received successfully");
      if (response.kpi) {
        console.log("✅ [Dashboard] KPI - Total Customer:", response.kpi.total_customer);
        try {
          console.log("✅ [Dashboard] KPI - Full data:", JSON.stringify(response.kpi, null, 2));
        } catch (e) {
          console.log("✅ [Dashboard] KPI - Full data: [Unable to stringify]");
        }
      }
      console.log("✅ [Dashboard] R Score Data length:", response.r_score_data?.length || 0);
      console.log("✅ [Dashboard] F Score Data length:", response.f_score_data?.length || 0);
      console.log("✅ [Dashboard] M Score Data length:", response.m_score_data?.length || 0);
      console.log("✅ [Dashboard] Segment Data length:", response.segment_data?.length || 0);
      try {
        console.log("✅ [Dashboard] Full Response:", JSON.stringify(response, null, 2));
      } catch (e) {
        console.log("✅ [Dashboard] Full Response: [Unable to stringify]");
      }
      
      // Validate and update all data from response with null checks
      if (response.kpi) {
        try {
          console.log("✅ [Dashboard] Updating KPI data:", JSON.stringify(response.kpi, null, 2));
        } catch (e) {
          console.log("✅ [Dashboard] Updating KPI data: [Unable to stringify]");
        }
        setKpiData(response.kpi);
      } else {
        console.warn("⚠️ [Dashboard] KPI data is missing in response");
      }
      
      if (response.r_score_data && Array.isArray(response.r_score_data)) {
        console.log("✅ [Dashboard] Updating R Score data, count:", response.r_score_data.length);
        setRScoreData(response.r_score_data);
      } else {
        console.warn("⚠️ [Dashboard] R Score data is missing or invalid");
        setRScoreData([]);
      }
      
      if (response.f_score_data && Array.isArray(response.f_score_data)) {
        console.log("✅ [Dashboard] Updating F Score data, count:", response.f_score_data.length);
        setFScoreData(response.f_score_data);
      } else {
        console.warn("⚠️ [Dashboard] F Score data is missing or invalid");
        setFScoreData([]);
      }
      
      if (response.m_score_data && Array.isArray(response.m_score_data)) {
        console.log("✅ [Dashboard] Updating M Score data, count:", response.m_score_data.length);
        setMScoreData(response.m_score_data);
      } else {
        console.warn("⚠️ [Dashboard] M Score data is missing or invalid");
        setMScoreData([]);
      }
      
      if (response.r_value_bucket_data && Array.isArray(response.r_value_bucket_data)) {
        setRValueBucketData(response.r_value_bucket_data);
      } else {
        setRValueBucketData([]);
      }
      
      if (response.visits_data && Array.isArray(response.visits_data)) {
        setVisitsData(response.visits_data);
      } else {
        setVisitsData([]);
      }
      
      if (response.value_data && Array.isArray(response.value_data)) {
        setValueData(response.value_data);
      } else {
        setValueData([]);
      }
      
      if (response.segment_data && Array.isArray(response.segment_data)) {
        console.log("✅ [Dashboard] Updating Segment data, count:", response.segment_data.length);
        setSegmentData(response.segment_data);
      } else {
        console.warn("⚠️ [Dashboard] Segment data is missing or invalid");
        setSegmentData([]);
      }
      
      if (response.days_to_return_bucket_data && Array.isArray(response.days_to_return_bucket_data)) {
        setDaysToReturnBucketData(response.days_to_return_bucket_data);
      } else {
        setDaysToReturnBucketData([]);
      }
      
      if (response.fiscal_year_data && Array.isArray(response.fiscal_year_data)) {
        setFiscalYearData(response.fiscal_year_data);
      } else {
        setFiscalYearData([]);
      }
      
      console.log("✅ [Dashboard] All state updated successfully from API response");
      
      // Clear any previous errors since we got a successful response
      setError(null);
    } catch (err) {
      // Clear progress interval on error
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
      if (controller.signal.aborted) {
        console.log("🟡 [Dashboard] Request was aborted");
        return;
      }
      const errorMsg = extractApiErrorMessage(err, "Failed to load dashboard data");
      // Safely log error - convert error object to string to avoid "Cannot convert object to primitive value"
      const errorDetails = err instanceof Error 
        ? `${err.name}: ${err.message}` 
        : typeof err === 'object' 
          ? JSON.stringify(err, Object.getOwnPropertyNames(err), 2)
          : String(err);
      console.error("❌ [Dashboard] Error loading dashboard data:", errorMsg);
      console.error("❌ [Dashboard] Error details:", errorDetails);
      
      // Always show error - don't try to use stale state values
      setError(errorMsg);
      
      if (errorMsg.includes("timeout") || errorMsg.includes("aborted")) {
        console.warn("⚠️ [Dashboard] Request timed out or was aborted");
      }
    } finally {
      if (!controller.signal.aborted) {
        if (isFilterApplication) {
          setApplyingFilters(false);
        } else {
          setLoading(false);
        }
      }
    }
  }, []); // Empty deps is OK - we're using setState functions which are stable

  const loadFilterOptions = useCallback(async () => {
    setFiltersLoading(true);
    console.log("🟢 [Filters] Starting to load filter options...");
    try {
      // Load filter options from database table via API with timeout
      console.log("🟢 [Filters] Calling getCampaignDashboardFilters()...");
      const options = await Promise.race([
        getCampaignDashboardFilters(),
        new Promise<FilterOptions>((_, reject) => 
          setTimeout(() => reject(new Error("Filter options request timed out")), 10000)
        )
      ]);
      
      console.log("🟢 [Filters] Filter options received from API");
      console.log("🟢 [Filters] Response type:", typeof options);
      console.log("🟢 [Filters] Response keys:", options ? Object.keys(options) : "null/undefined");
      console.log("🟢 [Filters] States count:", options?.states?.length || 0);
      console.log("🟢 [Filters] Cities count:", options?.cities?.length || 0);
      console.log("🟢 [Filters] Stores count:", options?.stores?.length || 0);
      console.log("🟢 [Filters] Segment maps count:", options?.segment_maps?.length || 0);
      
      // Validate response structure
      if (!options) {
        throw new Error("Filter options response is null or undefined");
      }
      
      if (!Array.isArray(options.states)) {
        console.warn("⚠️ [Filters] States is not an array:", options.states);
      }
      if (!Array.isArray(options.cities)) {
        console.warn("⚠️ [Filters] Cities is not an array:", options.cities);
      }
      if (!Array.isArray(options.stores)) {
        console.warn("⚠️ [Filters] Stores is not an array:", options.stores);
      }
      if (!Array.isArray(options.segment_maps)) {
        console.warn("⚠️ [Filters] Segment maps is not an array:", options.segment_maps);
      }
      
      try {
        console.log("🟢 [Filters] Full filter options:", JSON.stringify(options, null, 2));
      } catch (e) {
        console.log("🟢 [Filters] Filter options: [Unable to stringify]");
      }
      
      // Ensure all arrays exist, default to empty arrays if missing
      const safeOptions: FilterOptions = {
        states: Array.isArray(options.states) ? options.states : [],
        cities: Array.isArray(options.cities) ? options.cities : [],
        stores: Array.isArray(options.stores) ? options.stores : [],
        segment_maps: Array.isArray(options.segment_maps) ? options.segment_maps : [],
        r_value_buckets: Array.isArray(options.r_value_buckets) ? options.r_value_buckets : ["1", "2", "3", "4", "5"],
        f_value_buckets: Array.isArray(options.f_value_buckets) ? options.f_value_buckets : ["1", "2", "3", "4", "5"],
        m_value_buckets: Array.isArray(options.m_value_buckets) ? options.m_value_buckets : ["1", "2", "3", "4", "5"],
      };
      
      setFilterOptions(safeOptions);
      console.log("✅ [Filters] Filter options set successfully");
      console.log("✅ [Filters] Final state - States:", safeOptions.states.length, "Cities:", safeOptions.cities.length, "Stores:", safeOptions.stores.length, "Segments:", safeOptions.segment_maps.length);
    } catch (err: any) {
      // Safely log error - convert error object to string to avoid "Cannot convert object to primitive value"
      const errorDetails = err instanceof Error 
        ? `${err.name}: ${err.message}` 
        : typeof err === 'object' 
          ? JSON.stringify(err, Object.getOwnPropertyNames(err), 2)
          : String(err);
      console.error("❌ [Filters] Failed to load filter options from database:", errorDetails);
      console.error("❌ [Filters] Error stack:", err instanceof Error ? err.stack : "No stack trace");
      
      // Check if it's an HTTP error with response details
      if (err?.response) {
        console.error("❌ [Filters] HTTP Status:", err.response.status);
        console.error("❌ [Filters] HTTP Response:", err.response.data);
      }
      
      // Continue with empty options - filters will just be empty
      // Don't block the page - allow user to use dashboard without filters
      setFilterOptions({
        states: [],
        cities: [],
        stores: [],
        segment_maps: [],
        r_value_buckets: ["1", "2", "3", "4", "5"],
        f_value_buckets: ["1", "2", "3", "4", "5"],
        m_value_buckets: ["1", "2", "3", "4", "5"],
      });
    } finally {
      setFiltersLoading(false);
      console.log("🟢 [Filters] Filter loading completed, filtersLoading set to false");
    }
  }, []);

  useEffect(() => {
    // Only run initial load once
    if (initialLoadDoneRef.current) {
      return;
    }
    
    const idleHandle =
    typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(() => setChartsReady(true), { timeout: 500 })
      : window.setTimeout(() => setChartsReady(true), 150);
    
    setTimeout(() => {
      loadFilterOptions();
      // Load with default filters (all "All" = no filters)
      loadDashboardData({});
      initialLoadDoneRef.current = true; // Mark initial load as done
    }, 0);
    
    return () => {
      dashboardRequestRef.current?.abort();
      if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleHandle as number);
      } else {
        clearTimeout(idleHandle as number);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount

  const handleApplyFilters = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent event bubbling
    
    const filterParams: CampaignDashboardFilters = {};
    if (filters.state.length > 0) filterParams.state = filters.state;
    if (filters.city.length > 0) filterParams.city = filters.city;
    if (filters.store.length > 0) filterParams.store = filters.store;
    if (filters.segmentMap.length > 0) filterParams.segment_map = filters.segmentMap;
    if (filters.rValueBucket.length > 0) filterParams.r_value_bucket = filters.rValueBucket;
    if (filters.fValueBucket.length > 0) filterParams.f_value_bucket = filters.fValueBucket;
    if (filters.mValueBucket.length > 0) filterParams.m_value_bucket = filters.mValueBucket;
    
    // Load with filter application flag set to true
    await loadDashboardData(filterParams, true);
  };

  // Memoize formatters to avoid recreating on every render
  const formatCurrency = useCallback((value: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }, []);

  const formatNumber = useCallback((value: number) => {
    return new Intl.NumberFormat("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }, []);

  // Memoize display KPI data to avoid recalculation
  const displayKPIData = useMemo(() => ({
    totalCustomer: kpiData.total_customer,
    unitPerTransaction: kpiData.unit_per_transaction,
    customerSpending: kpiData.customer_spending,
    daysToReturn: kpiData.days_to_return,
    retentionRate: kpiData.retention_rate,
  }), [kpiData]);

  // Removed inline styles - using CSS classes with theme variables instead

  return (
    <div className="campaign-dashboard rfm-dashboard">
      <div className="dashboard-header">
        <h1>Campaign Dashboard</h1>
        <p>Customer Analytics & Insights</p>
      </div>

      {/* Filters Section */}
      {filtersLoading && (
        <div style={{ 
          padding: "12px 16px", 
          marginBottom: "16px",
          background: "#f0f9ff",
          border: "1px solid #0ea5e9",
          borderRadius: "6px",
          color: "#0369a1"
        }}>
          Loading filter options...
        </div>
      )}
      {!filtersLoading && filterOptions.states.length === 0 && filterOptions.cities.length === 0 && filterOptions.stores.length === 0 && (
        <div style={{ 
          padding: "12px 16px", 
          marginBottom: "16px",
          background: "#fef2f2",
          border: "1px solid #ef4444",
          borderRadius: "6px",
          color: "#dc2626",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px"
        }}>
          <span>⚠️ Filter options failed to load. Please check the browser console for details.</span>
          <button 
            type="button"
            onClick={() => {
              console.log("🟢 [Filters] Manual retry triggered");
              loadFilterOptions();
            }}
            style={{
              padding: "6px 12px",
              background: "#ef4444",
              color: "white",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "13px"
            }}
          >
            Retry
          </button>
        </div>
      )}
      <form 
        className="dashboard-filters filters" 
        onSubmit={handleApplyFilters}
        onKeyDown={(e) => {
          // Prevent accidental form submission on Enter key in non-input fields
          if (e.key === "Enter" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement)) {
            e.preventDefault();
          }
        }}
      >
        <div className="filter-row">
          <div className="filter-group filter-item select-field">
            <label>State</label>
            <select
              className="filter-select"
              value={filters.state}
              onChange={(e) => handleFilterChange("state", e.target.value)}
              disabled={filtersLoading}
            >
              <option>All</option>
              {filtersLoading ? (
                <option>Loading...</option>
              ) : filterOptions.states && filterOptions.states.length > 0 ? (
                filterOptions.states.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))
              ) : (
                <option disabled>No states available</option>
              )}
            </select>
          </div>
          <div className="filter-group filter-item select-field">
            <label>City</label>
            <select
              className="filter-select"
              value={filters.city}
              onChange={(e) => handleFilterChange("city", e.target.value)}
              disabled={filtersLoading}
            >
              <option>All</option>
              {filtersLoading ? (
                <option>Loading...</option>
              ) : filterOptions.cities && filterOptions.cities.length > 0 ? (
                filterOptions.cities.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))
              ) : (
                <option disabled>No cities available</option>
              )}
            </select>
          </div>
          <div className="filter-group filter-item select-field">
            <label>Store</label>
            <select
              className="filter-select"
              value={filters.store}
              onChange={(e) => handleFilterChange("store", e.target.value)}
              disabled={filtersLoading}
            >
              <option>All</option>
              {filtersLoading ? (
                <option>Loading...</option>
              ) : filterOptions.stores && filterOptions.stores.length > 0 ? (
                filterOptions.stores.map((store) => (
                  <option key={store} value={store}>
                    {store}
                  </option>
                ))
              ) : (
                <option disabled>No stores available</option>
              )}
            </select>
          </div>
          <div className="filter-group filter-item select-field">
            <label>Segment Map</label>
            <select
              className="filter-select"
              value={filters.segmentMap}
              onChange={(e) => handleFilterChange("segmentMap", e.target.value)}
              disabled={filtersLoading}
            >
              <option>All</option>
              {filtersLoading ? (
                <option>Loading...</option>
              ) : filterOptions.segment_maps && filterOptions.segment_maps.length > 0 ? (
                filterOptions.segment_maps.map((segment) => (
                  <option key={segment} value={segment}>
                    {segment}
                  </option>
                ))
              ) : (
                <option disabled>No segments available</option>
              )}
            </select>
          </div>
          <div className="filter-group filter-item select-field">
            <label>R Score</label>
            <select
              className="filter-select"
              value={filters.rValueBucket}
              onChange={(e) => handleFilterChange("rValueBucket", e.target.value)}
              disabled={filtersLoading}
            >
              <option>All</option>
              {filtersLoading ? (
                <option>Loading...</option>
              ) : (
                filterOptions.r_value_buckets.map((bucket) => {
                  const rScoreLabels: Record<string, string> = {
                    "1": "1 - Least Recent",
                    "2": "2 - Low Recency",
                    "3": "3 - Moderate Recency",
                    "4": "4 - Recent Purchase",
                    "5": "5 - Bought Most Recently",
                  };
                  return (
                    <option key={bucket} value={bucket}>
                      {rScoreLabels[bucket] || bucket}
                    </option>
                  );
                })
              )}
            </select>
          </div>
          <div className="filter-group filter-item select-field">
            <label>F Score</label>
            <select
              className="filter-select"
              value={filters.fValueBucket}
              onChange={(e) => handleFilterChange("fValueBucket", e.target.value)}
              disabled={filtersLoading}
            >
              <option>All</option>
              {filtersLoading ? (
                <option>Loading...</option>
              ) : (
                filterOptions.f_value_buckets.map((bucket) => {
                  const fScoreLabels: Record<string, string> = {
                    "1": "1 - Least Frequent",
                    "2": "2 - Low Frequency",
                    "3": "3 - Moderate Frequency",
                    "4": "4 - Frequent",
                    "5": "5 - Most Frequent",
                  };
                  return (
                    <option key={bucket} value={bucket}>
                      {fScoreLabels[bucket] || bucket}
                    </option>
                  );
                })
              )}
            </select>
          </div>
          <div className="filter-group filter-item select-field">
            <label>M Score</label>
            <select
              className="filter-select"
              value={filters.mValueBucket}
              onChange={(e) => handleFilterChange("mValueBucket", e.target.value)}
              disabled={filtersLoading}
            >
              <option>All</option>
              {filtersLoading ? (
                <option>Loading...</option>
              ) : (
                filterOptions.m_value_buckets.map((bucket) => {
                  const mScoreLabels: Record<string, string> = {
                    "1": "1 - Lowest Value",
                    "2": "2 - Low Value",
                    "3": "3 - Moderate Value",
                    "4": "4 - High Value",
                    "5": "5 - Highest Value",
                  };
                  return (
                    <option key={bucket} value={bucket}>
                      {mScoreLabels[bucket] || bucket}
                    </option>
                  );
                })
              )}
            </select>
          </div>
          <div className="filter-group filter-actions">
            <button type="submit" className="btn-apply" disabled={applyingFilters || loading}>
              {applyingFilters ? "Applying..." : "Apply"}
            </button>
          </div>
        </div>
      </form>

      {error && (
        <div className="dashboard-error" style={{ 
          background: "#fee2e2", 
          color: "#dc2626", 
          padding: "12px 16px", 
          borderRadius: "6px", 
          marginBottom: "24px" 
        }}>
          Error loading dashboard: {error}
        </div>
      )}


      {/* KPI Cards */}
      <div className="kpi-cards metrics">
        <div className="metric-card-total">
          <h4>Total Customer</h4>
          <p>{displayKPIData.totalCustomer.toLocaleString()}</p>
        </div>
        <div className="metric-card-total_profit">
          <h4>Unit Per Transaction</h4>
          <p>{formatNumber(displayKPIData.unitPerTransaction)}</p>
        </div>
        <div className="metric-card-total_spending">
          <h4>Avg Customer Spend</h4>
          <p>{formatCurrency(displayKPIData.customerSpending)}</p>
        </div>
        <div className="metric-card-total_return">
          <h4>Days to Return</h4>
          <p>{formatNumber(displayKPIData.daysToReturn)}</p>
        </div>
        <div className="metric-card-total_retention">
          <h4>Retention Rate</h4>
          <p>{displayKPIData.retentionRate.toFixed(2)}%</p>
        </div>
      </div>

      {/* Donut Charts - Lazy loaded */}
      {chartsReady && (
        <div className="charts-row charts">
          <LazyChart>
            <div className="chart-container">
              <h4>Total Customer by R Score</h4>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <defs>
                    {GRADIENTS.map((g) => (
                      <linearGradient id={`grad-r-${g.id}`} key={`grad-r-${g.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={g.start} />
                        <stop offset="100%" stopColor={g.end} />
                      </linearGradient>
                    ))}
                  </defs>
                  <Pie
                    data={rScoreData as any}
                    cx="50%"
                    cy="52%"
                    labelLine={true}
                    label={({ value }: any) => value}
                    outerRadius={65}
                    innerRadius={35}
                    fill="#8884d8"
                    dataKey="value"
                    isAnimationActive={false}
                  >
                    {rScoreData.map((_, index) => (
                      <Cell key={`cell-r-${index}`} fill={`url(#grad-r-grad${(index % GRADIENTS.length) + 1})`} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend 
                    layout="horizontal"
                    align="right"
                    verticalAlign="bottom"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '9px', fontWeight: 'bold', paddingTop: '6px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </LazyChart>
          <LazyChart>
            <div className="chart-container">
              <h4>Total Customer by F Score</h4>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <defs>
                    {GRADIENTS.map((g) => (
                      <linearGradient id={`grad-f-${g.id}`} key={`grad-f-${g.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={g.start} />
                        <stop offset="100%" stopColor={g.end} />
                      </linearGradient>
                    ))}
                  </defs>
                  <Pie
                    data={fScoreData as any}
                    cx="50%"
                    cy="52%"
                    labelLine={true}
                    label={({ value }: any) => value}
                    outerRadius={65}
                    innerRadius={35}
                    fill="#8884d8"
                    dataKey="value"
                    isAnimationActive={false}
                  >
                    {fScoreData.map((_, index) => (
                      <Cell key={`cell-f-${index}`} fill={`url(#grad-f-grad${(index % GRADIENTS.length) + 1})`} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend 
                    layout="horizontal"
                    align="right"
                    verticalAlign="bottom"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '9px', fontWeight: 'bold', paddingTop: '6px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </LazyChart>
          <LazyChart>
            <div className="chart-container">
              <h4>Total Customer by M Score</h4>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <defs>
                    {GRADIENTS.map((g) => (
                      <linearGradient id={`grad-m-${g.id}`} key={`grad-m-${g.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor={g.start} />
                        <stop offset="100%" stopColor={g.end} />
                      </linearGradient>
                    ))}
                  </defs>
                  <Pie
                    data={mScoreData as any}
                    cx="50%"
                    cy="52%"
                    labelLine={true}
                    label={({ value }: any) => value}
                    outerRadius={65}
                    innerRadius={35}
                    fill="#8884d8"
                    dataKey="value"
                    isAnimationActive={false}
                  >
                    {mScoreData.map((_, index) => (
                      <Cell key={`cell-m-${index}`} fill={`url(#grad-m-grad${(index % GRADIENTS.length) + 1})`} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend 
                    layout="horizontal"
                    align="right"
                    verticalAlign="bottom"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '9px', fontWeight: 'bold', paddingTop: '6px' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </LazyChart>
        </div>
      )}

      {/* Horizontal Bar Charts - Lazy loaded */}
      {chartsReady && (
        <div className="charts-row charts">
          <LazyChart>
            <div className="chart-container">
              <h4>Total Customer by Recency Score</h4>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={rValueBucketData} layout="vertical" margin={{ top: 5, right: 10, left: 30, bottom: 5 }}>
                  <XAxis 
                    type="number" 
                    dataKey="value"
                    domain={[0, 'dataMax']}
                    tick={{ fontSize: 9 }}
                    label={{ 
                      value: 'Total Customer', 
                      position: 'bottom', 
                      offset: 0 
                    }} 
                  />
                  <YAxis 
                    dataKey="name" 
                    type="category"
                    width={100}
                    tick={{ fontSize: 9 }}
                    label={{
                      value: 'Recency Score',
                      angle: -90,
                      position: 'insideLeft',
                      offset: -5,
                      style: { textAnchor: 'middle' }
                    }}
                  />
                  <Tooltip />
                  <Bar dataKey="value" isAnimationActive={false}>
                    {rValueBucketData.map((_, index) => (
                      <Cell key={`cell-bar-r-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </LazyChart>
          <LazyChart>
            <div className="chart-container">
              <h4>Total Customer by Frequency Score</h4>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={visitsData} layout="vertical" margin={{ top: 5, right: 10, left: 30, bottom: 5 }}>
                  <XAxis
                    type="number"
                    dataKey="value"
                    domain={[0, 'dataMax']}
                    tick={{ fontSize: 9 }}
                    label={{ value: 'Total Customer', position: 'bottom', offset: 0 }}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={100}
                    tick={{ fontSize: 9 }}
                    label={{ 
                      value: 'Frequency Score', 
                      angle: -90, 
                      position: 'insideLeft',
                      offset: -5,
                      style: { textAnchor: 'middle' }
                    }}
                  />
                  <Tooltip />
                  <Bar dataKey="value" isAnimationActive={false}>
                    {visitsData.map((_, index) => (
                      <Cell key={`cell-bar-v-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </LazyChart>
          <LazyChart>
            <div className="chart-container">
              <h4>Total Customer by Monetary Score</h4>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={valueData} layout="vertical" margin={{ top: 5, right: 10, left: 30, bottom: 5 }}>
                  <XAxis
                    type="number"
                    dataKey="value"
                    domain={[0, 'dataMax']}
                    tick={{ fontSize: 9 }}
                    label={{ value: 'Total Customer', position: 'bottom', offset: 0 }}
                  />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={100}
                    tick={{ fontSize: 9 }}
                    label={{ 
                      value: 'Monetary Score', 
                      angle: -90, 
                      position: 'insideLeft',
                      offset: -5,
                      style: { textAnchor: 'middle' }
                    }}
                  />
                  <Tooltip />
                  <Bar dataKey="value" isAnimationActive={false}>
                    {valueData.map((_, index) => (
                      <Cell key={`cell-bar-val-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </LazyChart>
        </div>
      )}

      {/* New Charts Section - All three charts in same row - Lazy loaded */}
      {chartsReady && (
        <div className="charts-row charts charts1">
          <LazyChart>
            <div className="chart-container treemap">
              <h4>Total Customer by Segment</h4>
              <ResponsiveContainer width="100%" height={220}>
                <Treemap
                  data={segmentData as any}
                  dataKey="value"
                  stroke="#fff"
                  fill="#8884d8"
                  isAnimationActive={false}
                  content={renderSegmentTreemapContent}
                >
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload;
                        const titleCaseName = (data.name || '')
                          .toLowerCase()
                          .split(' ')
                          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
                          .join(' ');
                        return (
                          <div style={{
                            backgroundColor: 'rgba(255, 255, 255, 0.95)',
                            padding: '8px 12px',
                            border: '1px solid #ccc',
                            borderRadius: '4px',
                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                          }}>
                            <p style={{ margin: 0, fontWeight: 'bold', color: data.fill, fontSize: '12px' }}>{titleCaseName}</p>
                            <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#333' }}>Count: {data.value?.toLocaleString()}</p>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </Treemap>
              </ResponsiveContainer>
            </div>
          </LazyChart>
          <LazyChart>
            <div className="chart-container">
              <h4>Current Vs New Customer % (FY)</h4>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={fiscalYearData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis yAxisId="left" domain={[0, 100]} label={{ value: "New Customer %", angle: -90, position: "insideLeft" }} />
                  <YAxis yAxisId="right" orientation="right" domain={[0, 100]} label={{ value: "Old Customer %", angle: 90, position: "insideRight" }} />
                  <Tooltip />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="new_customer_percent"
                    stroke="#22c55e"
                    strokeWidth={2}
                    name="New Customer %"
                    dot={{ r: 5 }}
                    activeDot={{ r: 7 }}
                    isAnimationActive={false}
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="old_customer_percent"
                    stroke="#0f6cbd"
                    strokeWidth={2}
                    name="Old Customer %"
                    dot={{ r: 5 }}
                    activeDot={{ r: 7 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </LazyChart>
          <LazyChart>
            <div className="chart-container">
              <h4>Days to Return Bucket</h4>
              <ResponsiveContainer width="100%" height={190}>
                <BarChart data={daysToReturnBucketData} barSize={18} margin={{ top: 10, right: 12, left: 12, bottom: 8 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#1E8449" isAnimationActive={false}>
                    <LabelList
                      dataKey="count"
                      position="top"
                      formatter={(v: any) => (typeof v === "number" ? v.toLocaleString() : v ?? "")}
                      style={{ fontSize: 10, fill: "#1a1a1a", fontWeight: 600 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </LazyChart>
        </div>
      )}
    </div>
  );
}

