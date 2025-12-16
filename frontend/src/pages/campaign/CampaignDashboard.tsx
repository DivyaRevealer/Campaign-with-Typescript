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
  type CampaignDashboardFilters, 
  type CampaignKPIData, 
  type ChartDataPoint,
  type SegmentDataPoint,
  type DaysToReturnBucketData,
  type FiscalYearData,
  type FilterOptions,
} from "../../api/campaign";
import { extractApiErrorMessage } from "../../api/errors";
import Autocomplete from "../../components/Autocomplete";
import "../common/adminTheme.css";
import "./CampaignDashboard.css";

// Types
interface DashboardFilters {
  startDate: string;
  endDate: string;
  customerMobile: string;
  customerName: string;
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


// Mock data - Fallback when API is not available
const mockKPIData: CampaignKPIData = {
  total_customer: 10000,
  unit_per_transaction: 10.81,
  profit_per_customer: 0.0,
  customer_spending: 76892.34,
  days_to_return: 142.93,
  retention_rate: 39.81,
};

const mockRScoreData: ChartDataPoint[] = [
  { name: "Bought Most Recently", value: 8500, count: 8500 },
  { name: "Other", value: 1500, count: 1500 },
];

const mockFScoreData: ChartDataPoint[] = [
  { name: "2", value: 624, count: 624 },
  { name: "3", value: 738, count: 738 },
  { name: "4", value: 1028, count: 1028 },
  { name: "More Frequent Visit", value: 1600, count: 1600 },
  { name: "Most Rarest Visit", value: 6010, count: 6010 },
];

const mockMScoreData: ChartDataPoint[] = [
  { name: "Category 1", value: 3198, count: 3198 },
  { name: "Category 2", value: 1702, count: 1702 },
  { name: "Category 3", value: 1771, count: 1771 },
  { name: "Category 4", value: 1615, count: 1615 },
  { name: "Category 5", value: 1714, count: 1714 },
];

const mockRValueBucketData: ChartDataPoint[] = [
  { name: "1-200", value: 9500 },
  { name: "200-400", value: 300 },
  { name: "400-600", value: 100 },
  { name: "600-800", value: 50 },
  { name: "800-1000", value: 30 },
  { name: ">1000", value: 20 },
];

const mockVisitsData: ChartDataPoint[] = [
  { name: "1", value: 6019 },
  { name: "2", value: 2000 },
  { name: "3", value: 1200 },
  { name: "4", value: 500 },
  { name: "5", value: 200 },
  { name: "6", value: 100 },
];

const mockValueData: ChartDataPoint[] = [
  { name: "1-1000", value: 1500 },
  { name: "1000-2000", value: 1200 },
  { name: "2000-3000", value: 1000 },
  { name: "3000-4000", value: 800 },
  { name: "4000-5000", value: 600 },
  { name: ">5000", value: 5974 },
];

const mockSegmentData: SegmentDataPoint[] = [
  { name: "POTENTIAL LOYALISTS", value: 4500, fill: "#7dd3fc" },
  { name: "NEW CUSTOMERS", value: 1800, fill: "#1e40af" },
  { name: "CHAMPIONS", value: 2200, fill: "#22c55e" },
  { name: "NEED ATTENTION", value: 1500, fill: "#2dd4bf" },
];

const mockDaysToReturnBucketData: DaysToReturnBucketData[] = [
  { name: "1-2 Month", count: 6800 },
  { name: "3-6 Month", count: 850 },
  { name: "1-2 Yr", count: 920 },
  { name: ">2 Yr", count: 1430 },
];

const mockFiscalYearData: FiscalYearData[] = [
  { year: "2020", new_customer_percent: 100, old_customer_percent: 0 },
  { year: "2021", new_customer_percent: 78, old_customer_percent: 22 },
  { year: "2022", new_customer_percent: 48, old_customer_percent: 52 },
  { year: "2023", new_customer_percent: 50, old_customer_percent: 50 },
  { year: "2024", new_customer_percent: 55, old_customer_percent: 45 },
];

const CalendarIcon = memo(() => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
));
CalendarIcon.displayName = "CalendarIcon";

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
    startDate: "",
    endDate: "",
    customerMobile: "All",
    customerName: "All",
    rValueBucket: "All",
    fValueBucket: "All",
    mValueBucket: "All",
  });
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    customer_mobiles: [],
    customer_names: [],
    customer_mobile_to_name: {},
    customer_name_to_mobile: {},
    r_value_buckets: [],
    f_value_buckets: [],
    m_value_buckets: [],
  });
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [kpiData, setKpiData] = useState<CampaignKPIData>(mockKPIData);
  const [rScoreData, setRScoreData] = useState<ChartDataPoint[]>(mockRScoreData);
  const [fScoreData, setFScoreData] = useState<ChartDataPoint[]>(mockFScoreData);
  const [mScoreData, setMScoreData] = useState<ChartDataPoint[]>(mockMScoreData);
  const [rValueBucketData, setRValueBucketData] = useState<ChartDataPoint[]>(mockRValueBucketData);
  const [visitsData, setVisitsData] = useState<ChartDataPoint[]>(mockVisitsData);
  const [valueData, setValueData] = useState<ChartDataPoint[]>(mockValueData);
  const [segmentData, setSegmentData] = useState<SegmentDataPoint[]>(mockSegmentData);
  const [daysToReturnBucketData, setDaysToReturnBucketData] = useState<DaysToReturnBucketData[]>(mockDaysToReturnBucketData);
  const [fiscalYearData, setFiscalYearData] = useState<FiscalYearData[]>(mockFiscalYearData);
  const [chartsReady, setChartsReady] = useState(false);
  const dashboardRequestRef = useRef<AbortController | null>(null);
  const handleFilterChange = (field: keyof DashboardFilters, value: string) => {
    setFilters((prev) => {
      const updated = { ...prev, [field]: value };
      
      // Sync customer mobile and customer name
      if (field === "customerMobile" && value !== "All") {
        const customerName = filterOptions.customer_mobile_to_name?.[value];
        if (customerName) {
          updated.customerName = customerName;
        }
      } else if (field === "customerName" && value !== "All") {
        const customerMobile = filterOptions.customer_name_to_mobile?.[value];
        if (customerMobile) {
          updated.customerMobile = customerMobile;
        }
      }
      
      return updated;
    });
  };

  const loadDashboardData = useCallback(async (filterParams?: CampaignDashboardFilters) => {
    // Don't block UI - show mock data immediately, update later
    setError(null);
    
    setLoading(true);

    // Cancel any in-flight dashboard request to keep the UI responsive
    dashboardRequestRef.current?.abort();
    const controller = new AbortController();
    dashboardRequestRef.current = controller;

    try {
      const response = await getCampaignDashboard(filterParams, controller.signal);
      setKpiData(response.kpi);
      setRScoreData(response.r_score_data);
      setFScoreData(response.f_score_data);
      setMScoreData(response.m_score_data);
      setRValueBucketData(response.r_value_bucket_data);
      setVisitsData(response.visits_data);
      setValueData(response.value_data);
      setSegmentData(response.segment_data);
      setDaysToReturnBucketData(response.days_to_return_bucket_data);
      setFiscalYearData(response.fiscal_year_data);
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      const errorMsg = extractApiErrorMessage(err, "Failed to load dashboard data");
      setError(errorMsg);
      console.error("Failed to load dashboard data:", err);
      if (errorMsg.includes("timeout") || errorMsg.includes("aborted")) {
        console.warn("Dashboard data request timed out - using mock data");
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, []);

  const loadFilterOptions = useCallback(async () => {
    setFiltersLoading(true);
    try {
      // Load filter options from database table via API with timeout
      const options = await Promise.race([
        getCampaignDashboardFilters(),
        new Promise<FilterOptions>((_, reject) => 
          setTimeout(() => reject(new Error("Filter options request timed out")), 10000)
        )
      ]);
      console.log("Filter options loaded from database:", options);
      setFilterOptions(options);
    } catch (err) {
      console.error("Failed to load filter options from database:", err);
      // Continue with empty options - filters will just be empty
      // Don't block the page - allow user to use dashboard without filters
      setFilterOptions({
        customer_mobiles: [],
        customer_names: [],
        customer_mobile_to_name: {},
        customer_name_to_mobile: {},
        r_value_buckets: [],
        f_value_buckets: [],
        m_value_buckets: [],
      });
    } finally {
      setFiltersLoading(false);
    }
  }, []);

  useEffect(() => {
    const idleHandle =
    typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
      ? window.requestIdleCallback(() => setChartsReady(true), { timeout: 500 })
      : window.setTimeout(() => setChartsReady(true), 150);
    setTimeout(() => {
      loadFilterOptions();
      loadDashboardData();
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
    const filterParams: CampaignDashboardFilters = {};
    if (filters.startDate) filterParams.start_date = filters.startDate;
    if (filters.endDate) filterParams.end_date = filters.endDate;
    if (filters.customerMobile !== "All") filterParams.customer_mobile = filters.customerMobile;
    if (filters.customerName !== "All") filterParams.customer_name = filters.customerName;
    if (filters.rValueBucket !== "All") filterParams.r_value_bucket = filters.rValueBucket;
    if (filters.fValueBucket !== "All") filterParams.f_value_bucket = filters.fValueBucket;
    if (filters.mValueBucket !== "All") filterParams.m_value_bucket = filters.mValueBucket;
    
    await loadDashboardData(filterParams);
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
    profitPerCustomer: kpiData.profit_per_customer,
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
      <form className="dashboard-filters filters" onSubmit={handleApplyFilters}>
        <div className="filter-row">
          <div className="filter-group filter-item date-field">
            <label>Start Date</label>
            <div className="date-input-wrapper">
              <CalendarIcon />
              <input
                type="date"
                value={filters.startDate}
                onChange={(e) => handleFilterChange("startDate", e.target.value)}
              />
            </div>
          </div>
          <div className="filter-group filter-item date-field">
            <label>End Date</label>
            <div className="date-input-wrapper">
              <CalendarIcon />
              <input
                type="date"
                value={filters.endDate}
                onChange={(e) => handleFilterChange("endDate", e.target.value)}
              />
            </div>
          </div>
          <div className="filter-group filter-item autocomplete-field">
            <label>Customer Mobile No</label>
            <Autocomplete
              value={filters.customerMobile}
              options={filterOptions.customer_mobiles}
              onChange={(value) => handleFilterChange("customerMobile", value)}
              placeholder="Mobile number"
              disabled={filtersLoading}
              allowAll={true}
              allLabel="All"
            />
          </div>
          <div className="filter-group filter-item autocomplete-field">
            <label>Customer Name</label>
            <Autocomplete
              value={filters.customerName}
              options={filterOptions.customer_names}
              onChange={(value) => handleFilterChange("customerName", value)}
              placeholder="Customer name"
              disabled={filtersLoading}
              allowAll={true}
              allLabel="All"
            />
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
            <button type="submit" className="btn-apply" disabled={loading}>
              {loading ? "Applying..." : "Apply"}
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
        <div className="metric-card-total_unit">
          <h4>Profit Per Customer</h4>
          <p>{formatCurrency(displayKPIData.profitPerCustomer)}</p>
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

