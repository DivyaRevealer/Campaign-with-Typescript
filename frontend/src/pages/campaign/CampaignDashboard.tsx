import { useState, useEffect, useCallback, useMemo, memo, useRef, type FormEvent } from "react";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  LineChart,
  Line,
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
  getStoresInfo,
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
  state: string[];  // Multi-select support
  city: string[];  // Multi-select support
  store: string[];  // Multi-select support
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

// Custom Funnel Chart Component
const FunnelChart: React.FC<{ data: SegmentDataPoint[] }> = ({ data }) => {
  // Sort data by value descending for funnel visualization (largest at top)
  const sortedData = [...data].sort((a, b) => b.value - a.value);
  const totalSegments = sortedData.length;
  
  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '1px', 
      padding: '8px',
      height: '100%',
      justifyContent: 'flex-start',
      alignItems: 'center',
      overflow: 'hidden'
    }}>
      {sortedData.map((item, index) => {
        // Calculate width percentage - largest at top (100%), smallest at bottom
        // Create a smooth funnel shape
        const positionRatio = index / (totalSegments - 1 || 1);
        const widthPercentage = 100 - (positionRatio * 40); // Start at 100%, end at 60%
        
        return (
          <div
            key={item.name}
            style={{
              position: 'relative',
              width: `${widthPercentage}%`,
              minWidth: '180px',
              height: '28px',
              backgroundColor: item.fill || COLORS[index % COLORS.length],
              borderRadius: '3px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 10px',
              color: '#fff',
              fontWeight: 600,
              fontSize: '11px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.15)',
              transition: 'all 0.3s ease',
              border: '1px solid rgba(255,255,255,0.2)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.02)';
              e.currentTarget.style.boxShadow = '0 4px 8px rgba(0,0,0,0.25)';
              e.currentTarget.style.zIndex = '10';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.15)';
              e.currentTarget.style.zIndex = '1';
            }}
          >
            <span style={{ 
              flex: 1, 
              textOverflow: 'ellipsis', 
              overflow: 'hidden', 
              whiteSpace: 'nowrap',
              textShadow: '1px 1px 2px rgba(0,0,0,0.6)',
              fontWeight: 600,
              fontSize: '11px'
            }}>
              {item.name}
            </span>
            <span style={{ 
              marginLeft: '10px', 
              fontWeight: 700,
              fontSize: '11px',
              textShadow: '1px 1px 2px rgba(0,0,0,0.6)',
              whiteSpace: 'nowrap'
            }}>
              {item.value.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
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

// Multi-Select Dropdown Component
interface MultiSelectProps {
  label: string;
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

const MultiSelect: React.FC<MultiSelectProps> = ({
  label,
  options,
  selected,
  onChange,
  disabled = false,
  placeholder = "Select options...",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isScrollingDropdownRef = useRef(false);

  // Close dropdown when clicking outside or scrolling
  useEffect(() => {
    if (!isOpen) return; // Only attach listeners when dropdown is open
    
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleScroll = (e: Event) => {
      // If we're currently scrolling inside the dropdown, don't close
      if (isScrollingDropdownRef.current) {
        return;
      }
      
      // Check if scroll target is inside the dropdown
      const target = e.target as Node;
      if (dropdownRef.current && dropdownRef.current.contains(target)) {
        // Scroll is inside dropdown, don't close
        return;
      }
      
      // Scroll is outside dropdown (page scroll), close it
      setIsOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("scroll", handleScroll, true); // Use capture phase to catch all scrolls
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [isOpen]);

  const handleToggle = (value: string) => {
    if (disabled) return;
    const newSelected = selected.includes(value)
      ? selected.filter((s) => s !== value)
      : [...selected, value];
    onChange(newSelected);
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const displayText = selected.length === 0 
    ? placeholder 
    : selected.length === 1 
    ? selected[0] 
    : `${selected.length} selected`;

  return (
    <div className="filter-group filter-item select-field">
      <label>{label}</label>
      <div className="multi-select-wrapper" ref={dropdownRef}>
        <div
          className={`multi-select ${isOpen ? "open" : ""} ${disabled ? "disabled" : ""}`}
          onClick={() => !disabled && setIsOpen(!isOpen)}
        >
          <span className="multi-select-display">{displayText}</span>
          <span className="multi-select-arrow">{isOpen ? "▲" : "▼"}</span>
          {selected.length > 0 && (
            <span className="multi-select-clear" onClick={handleClearAll}>
              ×
            </span>
          )}
        </div>
        {isOpen && !disabled && (
          <div 
            className="multi-select-dropdown"
            onScroll={(e) => {
              // Mark that we're scrolling inside the dropdown
              isScrollingDropdownRef.current = true;
              // Stop scroll event from bubbling to window
              e.stopPropagation();
              // Reset flag after a short delay
              setTimeout(() => {
                isScrollingDropdownRef.current = false;
              }, 100);
            }}
          >
            {options.length === 0 ? (
              <div className="multi-select-option disabled">No options available</div>
            ) : (
              // Remove duplicates from options array (in case backend returns duplicates)
              Array.from(new Set(options)).map((option) => (
                <div
                  key={option}
                  className={`multi-select-option ${selected.includes(option) ? "selected" : ""}`}
                  onClick={() => handleToggle(option)}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => handleToggle(option)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span>{option}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default function CampaignDashboard() {
  const [filters, setFilters] = useState<DashboardFilters>({
    state: [],  // Multi-select: empty array means "All"
    city: [],  // Multi-select: empty array means "All"
    store: [],  // Multi-select: empty array means "All"
    segmentMap: "All",
    rValueBucket: "All",
    fValueBucket: "All",
    mValueBucket: "All",
  });
  
  // Filter options (loaded from API)
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
  const filtersRef = useRef(filters); // Keep a ref to current filters for async operations
  
  // Update ref whenever filters change
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);
  
  /**
   * Load filter options from API with cascading support.
   * Calls getCampaignDashboardFilters with current filter selections.
   */
  const loadFilterOptions = useCallback(async (currentState: string[], currentCity: string[], currentStore: string[]) => {
    setFiltersLoading(true);
    console.log(`🟢 [Filters] Loading options with: state=[${currentState.join(", ")}], city=[${currentCity.join(", ")}], store=[${currentStore.join(", ")}]`);
    
    try {
      console.log("🟢 [Filters] Making API call to getCampaignDashboardFilters...");
      const options = await getCampaignDashboardFilters(
        currentState.length > 0 ? currentState : undefined,
        currentCity.length > 0 ? currentCity : undefined,
        currentStore.length > 0 ? currentStore : undefined
      );
      
      console.log(`✅ [Filters] Received options: ${options.states.length} states, ${options.cities.length} cities, ${options.stores.length} stores`);
      console.log(`✅ [Filters] Sample states: ${options.states.slice(0, 5).join(", ")}`);
      console.log(`✅ [Filters] Sample cities: ${options.cities.slice(0, 5).join(", ")}`);
      console.log(`✅ [Filters] Sample stores: ${options.stores.slice(0, 5).join(", ")}`);
      
      // Update filter options - preserve other filter options, only update states/cities/stores
      setFilterOptions(prev => ({
        ...prev,
        states: options.states || [],
        cities: options.cities || [],
        stores: options.stores || [],
        segment_maps: options.segment_maps || prev.segment_maps,
        r_value_buckets: options.r_value_buckets || prev.r_value_buckets,
        f_value_buckets: options.f_value_buckets || prev.f_value_buckets,
        m_value_buckets: options.m_value_buckets || prev.m_value_buckets,
      }));
      
      console.log(`✅ [Filters] Filter options state updated`);
    } catch (err: any) {
      const errorDetails = err instanceof Error 
        ? `${err.name}: ${err.message}` 
        : typeof err === 'object' 
          ? JSON.stringify(err, Object.getOwnPropertyNames(err), 2)
          : String(err);
      console.error("❌ [Filters] Failed to load filter options from database:", errorDetails);
      
      // Continue with empty options - filters will just be empty
      setFilterOptions(prev => ({
        ...prev,
        states: [],
        cities: [],
        stores: [],
      }));
    } finally {
      setFiltersLoading(false);
      console.log("🟢 [Filters] Filter loading completed");
    }
  }, []);
  
  /**
   * Handle multi-select filter changes with cascading support.
   * Makes API calls to get updated filter options based on selections.
   */
  const handleMultiSelectFilterChange = async (field: "state" | "city" | "store", selected: string[]) => {
    console.log(`🟢 [Filters] handleFilterChange: ${field} = [${selected.join(", ")}]`);
    
    // Calculate the new filter state
    let newState: string[] = [...filters.state];
    let newCity: string[] = [...filters.city];
    let newStore: string[] = [...filters.store];
    
    // Update the changed field and handle cascading resets
    if (field === "state") {
      newState = selected;
      // Reset dependent filters when states change
      newCity = [];
      newStore = [];
    } else if (field === "city") {
      newCity = selected;
      // Reset dependent filters when cities change
      newStore = [];
    } else if (field === "store") {
      newStore = selected;
    }
    
    // Handle store selection - auto-adjust states and cities
    if (field === "store" && selected.length > 0) {
      try {
        const storeInfo = await getStoresInfo(selected);
        if (storeInfo.states.length > 0 || storeInfo.cities.length > 0) {
          console.log(`✅ [Filters] Stores selected: auto-adjusting states to [${storeInfo.states.join(", ")}], cities to [${storeInfo.cities.join(", ")}]`);
          newState = storeInfo.states.length > 0 ? storeInfo.states : newState;
          newCity = storeInfo.cities.length > 0 ? storeInfo.cities : newCity;
        }
      } catch (err) {
        console.error("❌ [Filters] Failed to get store info:", err);
      }
    }
    
    // Handle city selection - auto-adjust states to match selected cities
    if (field === "city" && selected.length > 0) {
      try {
        // Get filter options with city filter to find matching states
        const options = await getCampaignDashboardFilters(
          undefined, // no state filter yet
          selected,  // city filter
          undefined  // no store filter
        );
        if (options.states.length > 0) {
          console.log(`✅ [Filters] Cities selected: auto-adjusting states to [${options.states.join(", ")}]`);
          newState = options.states;
        }
      } catch (err) {
        console.error("❌ [Filters] Failed to get states for cities:", err);
      }
    }
    
    // Update filters state immediately (synchronously)
    setFilters({
      ...filters,
      state: newState,
      city: newCity,
      store: newStore,
    });
    
    // Load updated filter options from API (cascading)
    // Use the calculated new values directly, not from state
    await loadFilterOptions(newState, newCity, newStore);
  };

  // Handler for single-select filters (segmentMap, rValueBucket, etc.)
  const handleFilterChange = (field: "segmentMap" | "rValueBucket" | "fValueBucket" | "mValueBucket", value: string) => {
    setFilters((prev) => ({
      ...prev,
      [field]: value,
    }));
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
    // Build URLSearchParams manually to handle arrays
    const params = new URLSearchParams();
    if (filterParams?.state && Array.isArray(filterParams.state)) {
      filterParams.state.forEach(s => params.append("state", s));
    }
    if (filterParams?.city && Array.isArray(filterParams.city)) {
      filterParams.city.forEach(c => params.append("city", c));
    }
    if (filterParams?.store && Array.isArray(filterParams.store)) {
      filterParams.store.forEach(s => params.append("store", s));
    }
    if (filterParams?.segment_map) params.append("segment_map", filterParams.segment_map);
    if (filterParams?.r_value_bucket) params.append("r_value_bucket", filterParams.r_value_bucket);
    if (filterParams?.f_value_bucket) params.append("f_value_bucket", filterParams.f_value_bucket);
    if (filterParams?.m_value_bucket) params.append("m_value_bucket", filterParams.m_value_bucket);
    const apiUrl = filterParams ? `/campaign/dashboard?${params.toString()}` : "/campaign/dashboard";
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
      // Load filter options initially (no filters selected = all options)
      loadFilterOptions([], [], []);
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
              loadFilterOptions([], [], []);
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
          <MultiSelect
            label="State"
            options={filterOptions.states || []}
            selected={filters.state}
            onChange={(selected) => handleMultiSelectFilterChange("state", selected)}
            disabled={filtersLoading}
            placeholder="Select states..."
          />
          <MultiSelect
            label="City"
            options={filterOptions.cities || []}
            selected={filters.city}
            onChange={(selected) => handleMultiSelectFilterChange("city", selected)}
            disabled={filtersLoading}
            placeholder="Select cities..."
          />
          <MultiSelect
            label="Store"
            options={filterOptions.stores || []}
            selected={filters.store}
            onChange={(selected) => handleMultiSelectFilterChange("store", selected)}
            disabled={filtersLoading}
            placeholder="Select stores..."
          />
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

      {/* Loading Overlay */}
      {loading && (
        <div className="dashboard-loader-overlay">
          <div className="dashboard-loader">
            <div className="loader-spinner"></div>
            <p>Loading dashboard data...</p>
          </div>
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
                <BarChart data={[...rValueBucketData].reverse()} layout="vertical" margin={{ top: 5, right: 50, left: 30, bottom: 5 }}>
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
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e0e0e0',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      padding: '10px 12px'
                    }}
                    cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                  />
                  <Bar 
                    dataKey="value" 
                    isAnimationActive={false}
                    radius={[0, 8, 8, 0]}
                    barSize={20}
                    style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}
                  >
                    {[...rValueBucketData].reverse().map((_, index) => (
                      <Cell 
                        key={`cell-bar-r-${index}`} 
                        fill={COLORS[index % COLORS.length]}
                        style={{ 
                          transition: 'opacity 0.2s',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={(e: any) => {
                          if (e) {
                            e.target.style.opacity = 0.8;
                          }
                        }}
                        onMouseLeave={(e: any) => {
                          if (e) {
                            e.target.style.opacity = 1;
                          }
                        }}
                      />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      offset={5}
                      formatter={(v: any) => (typeof v === "number" ? v.toLocaleString() : v ?? "")}
                      style={{ 
                        fontSize: 11, 
                        fill: "#333", 
                        fontWeight: 600
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </LazyChart>
          <LazyChart>
            <div className="chart-container">
              <h4>Total Customer by Frequency Score</h4>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={[...visitsData].reverse()} layout="vertical" margin={{ top: 5, right: 50, left: 30, bottom: 5 }}>
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
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e0e0e0',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      padding: '10px 12px'
                    }}
                    cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                  />
                  <Bar 
                    dataKey="value" 
                    isAnimationActive={false}
                    radius={[0, 8, 8, 0]}
                    barSize={20}
                    style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}
                  >
                    {[...visitsData].reverse().map((_, index) => (
                      <Cell 
                        key={`cell-bar-v-${index}`} 
                        fill={COLORS[index % COLORS.length]}
                        style={{ 
                          transition: 'opacity 0.2s',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={(e: any) => {
                          if (e) {
                            e.target.style.opacity = 0.8;
                          }
                        }}
                        onMouseLeave={(e: any) => {
                          if (e) {
                            e.target.style.opacity = 1;
                          }
                        }}
                      />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      offset={5}
                      formatter={(v: any) => (typeof v === "number" ? v.toLocaleString() : v ?? "")}
                      style={{ 
                        fontSize: 11, 
                        fill: "#333", 
                        fontWeight: 600
                      }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </LazyChart>
          <LazyChart>
            <div className="chart-container">
              <h4>Total Customer by Monetary Score</h4>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={[...valueData].reverse()} layout="vertical" margin={{ top: 5, right: 50, left: 30, bottom: 5 }}>
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
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e0e0e0',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      padding: '10px 12px'
                    }}
                    cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                  />
                  <Bar 
                    dataKey="value" 
                    isAnimationActive={false}
                    radius={[0, 8, 8, 0]}
                    barSize={20}
                    style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}
                  >
                    {[...valueData].reverse().map((_, index) => (
                      <Cell 
                        key={`cell-bar-val-${index}`} 
                        fill={COLORS[index % COLORS.length]}
                        style={{ 
                          transition: 'opacity 0.2s',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={(e: any) => {
                          if (e) {
                            e.target.style.opacity = 0.8;
                          }
                        }}
                        onMouseLeave={(e: any) => {
                          if (e) {
                            e.target.style.opacity = 1;
                          }
                        }}
                      />
                    ))}
                    <LabelList
                      dataKey="value"
                      position="right"
                      offset={5}
                      formatter={(v: any) => (typeof v === "number" ? v.toLocaleString() : v ?? "")}
                      style={{ 
                        fontSize: 11, 
                        fill: "#333", 
                        fontWeight: 600
                      }}
                    />
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
              <div style={{ height: '220px', width: '100%', overflow: 'hidden' }}>
                <FunnelChart data={segmentData} />
              </div>
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
                  <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" opacity={0.5} />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 10 }}
                    axisLine={{ stroke: '#d0d0d0', strokeWidth: 1 }}
                    tickLine={{ stroke: '#d0d0d0' }}
                  />
                  <YAxis 
                    tick={{ fontSize: 10 }}
                    axisLine={{ stroke: '#d0d0d0', strokeWidth: 1 }}
                    tickLine={{ stroke: '#d0d0d0' }}
                  />
                  <Tooltip 
                    contentStyle={{
                      backgroundColor: 'rgba(255, 255, 255, 0.95)',
                      border: '1px solid #e0e0e0',
                      borderRadius: '8px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      padding: '10px 12px'
                    }}
                    cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
                  />
                  <Bar 
                    dataKey="count" 
                    isAnimationActive={false}
                    radius={[8, 8, 0, 0]}
                    style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))' }}
                  >
                    {daysToReturnBucketData.map((_, index) => (
                      <Cell 
                        key={`cell-bar-days-${index}`} 
                        fill={COLORS[index % COLORS.length]}
                        style={{ 
                          transition: 'opacity 0.2s',
                          cursor: 'pointer'
                        }}
                        onMouseEnter={(e: any) => {
                          if (e) {
                            e.target.style.opacity = 0.8;
                          }
                        }}
                        onMouseLeave={(e: any) => {
                          if (e) {
                            e.target.style.opacity = 1;
                          }
                        }}
                      />
                    ))}
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

