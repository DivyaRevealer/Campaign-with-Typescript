import { useState, useEffect, useCallback, useMemo, memo, type FormEvent } from "react";
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

const COLORS = {
  primary: "#14b8a6",
  secondary: "#0d9488",
  accent: "#06b6d4",
  orange: "#f97316",
  purple: "#a855f7",
  teal: "#2dd4bf",
  yellow: "#eab308",
  red: "#ef4444",
};

const KPI_CARD_COLORS = [
  COLORS.primary,
  COLORS.accent,
  COLORS.orange,
  COLORS.purple,
  COLORS.teal,
  COLORS.secondary,
];

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
    r_value_buckets: [],
    f_value_buckets: [],
    m_value_buckets: [],
  });
  const [loading, setLoading] = useState(false);
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

  const handleFilterChange = (field: keyof DashboardFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [field]: value }));
  };

  const loadDashboardData = useCallback(async (filterParams?: CampaignDashboardFilters) => {
    setLoading(true);
    setError(null);
    setChartsReady(false); // Reset charts ready state
    try {
      const response = await getCampaignDashboard(filterParams);
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
      
      // Defer chart rendering to avoid blocking UI
      // Use setTimeout to allow browser to paint KPI cards first
      setTimeout(() => {
        setChartsReady(true);
      }, 100);
    } catch (err) {
      setError(extractApiErrorMessage(err));
      // Keep mock data on error for development
      console.error("Failed to load dashboard data:", err);
      setChartsReady(true); // Show charts even on error
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFilterOptions = useCallback(async () => {
    try {
      const options = await getCampaignDashboardFilters();
      setFilterOptions(options);
    } catch (err) {
      console.error("Failed to load filter options:", err);
      // Continue with empty options - filters will just be empty
    }
  }, []);

  useEffect(() => {
    // Load filter options first, then dashboard data
    // Only run once on component mount
    loadFilterOptions();
    loadDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps - only run on mount

  // Initialize charts ready state for initial mock data
  useEffect(() => {
    if (!loading && !chartsReady) {
      // Small delay to allow initial render to complete
      const timer = setTimeout(() => setChartsReady(true), 50);
      return () => clearTimeout(timer);
    }
  }, [loading, chartsReady]);

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

  // Memoize container styles to avoid creating new object on every render
  const containerStyle = useMemo(() => ({
    minHeight: "100vh",
    backgroundColor: "#f0f2f5",
    padding: "20px",
    color: "#1a1a1a"
  }), []);

  return (
    <div className="campaign-dashboard rfm-dashboard" style={containerStyle}>
      <div className="dashboard-header">
        <h1>Campaign Dashboard</h1>
        <p>Customer Analytics & Insights</p>
      </div>

      {/* Filters Section */}
      <form className="dashboard-filters filters" onSubmit={handleApplyFilters}>
        <div className="filter-row">
          <div className="filter-group filter-item">
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
          <div className="filter-group filter-item">
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
          <div className="filter-group filter-item">
            <label>Customer Mobile No</label>
            <select
              className="filter-select"
              value={filters.customerMobile}
              onChange={(e) => handleFilterChange("customerMobile", e.target.value)}
            >
              <option>All</option>
              {filterOptions.customer_mobiles.map((mobile) => (
                <option key={mobile} value={mobile}>
                  {mobile}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group filter-item">
            <label>Customer Name</label>
            <select
              className="filter-select"
              value={filters.customerName}
              onChange={(e) => handleFilterChange("customerName", e.target.value)}
            >
              <option>All</option>
              {filterOptions.customer_names.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-group filter-item">
            <label>R Value Bucket</label>
            <select
              className="filter-select"
              value={filters.rValueBucket}
              onChange={(e) => handleFilterChange("rValueBucket", e.target.value)}
            >
              <option>All</option>
              {filterOptions.r_value_buckets.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {bucket}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group filter-item">
            <label>F Value Bucket</label>
            <select
              className="filter-select"
              value={filters.fValueBucket}
              onChange={(e) => handleFilterChange("fValueBucket", e.target.value)}
            >
              <option>All</option>
              {filterOptions.f_value_buckets.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {bucket}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group filter-item">
            <label>M Value Bucket</label>
            <select
              className="filter-select"
              value={filters.mValueBucket}
              onChange={(e) => handleFilterChange("mValueBucket", e.target.value)}
            >
              <option>All</option>
              {filterOptions.m_value_buckets.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {bucket}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group filter-actions">
            <button type="submit" className="btn-apply" disabled={loading}>
              {loading ? "Applying..." : "Apply Filter"}
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

      {loading && (
        <div style={{ 
          textAlign: "center", 
          padding: "40px", 
          fontSize: "18px", 
          color: "#666" 
        }}>
          Loading dashboard data...
        </div>
      )}

      {/* KPI Cards */}
      <div className="kpi-cards metrics">
        <div className="kpi-card" style={{ borderTopColor: KPI_CARD_COLORS[0] }}>
          <div className="kpi-icon" style={{ backgroundColor: KPI_CARD_COLORS[0] + "20" }}>
            ⭐
          </div>
          <div className="kpi-content">
            <div className="kpi-label">Total Customer</div>
            <div className="kpi-value">{displayKPIData.totalCustomer.toLocaleString()}</div>
          </div>
        </div>
        <div className="kpi-card" style={{ borderTopColor: KPI_CARD_COLORS[1] }}>
          <div className="kpi-icon" style={{ backgroundColor: KPI_CARD_COLORS[1] + "20" }}>
            💰
          </div>
          <div className="kpi-content">
            <div className="kpi-label">Unit Per Transaction</div>
            <div className="kpi-value">{formatNumber(displayKPIData.unitPerTransaction)}</div>
          </div>
        </div>
        <div className="kpi-card" style={{ borderTopColor: KPI_CARD_COLORS[2] }}>
          <div className="kpi-icon" style={{ backgroundColor: KPI_CARD_COLORS[2] + "20" }}>
            💵
          </div>
          <div className="kpi-content">
            <div className="kpi-label">Profit Per Customer</div>
            <div className="kpi-value">{formatCurrency(displayKPIData.profitPerCustomer)}</div>
          </div>
        </div>
        <div className="kpi-card" style={{ borderTopColor: KPI_CARD_COLORS[3] }}>
          <div className="kpi-icon" style={{ backgroundColor: KPI_CARD_COLORS[3] + "20" }}>
            🛒
          </div>
          <div className="kpi-content">
            <div className="kpi-label">Customer Spending</div>
            <div className="kpi-value">{formatCurrency(displayKPIData.customerSpending)}</div>
          </div>
        </div>
        <div className="kpi-card" style={{ borderTopColor: KPI_CARD_COLORS[4] }}>
          <div className="kpi-icon" style={{ backgroundColor: KPI_CARD_COLORS[4] + "20" }}>
            🔄
          </div>
          <div className="kpi-content">
            <div className="kpi-label">Days to Return</div>
            <div className="kpi-value">{formatNumber(displayKPIData.daysToReturn)}</div>
          </div>
        </div>
        <div className="kpi-card" style={{ borderTopColor: KPI_CARD_COLORS[5] }}>
          <div className="kpi-icon" style={{ backgroundColor: KPI_CARD_COLORS[5] + "20" }}>
            🔗
          </div>
          <div className="kpi-content">
            <div className="kpi-label">Retention Rate</div>
            <div className="kpi-value">{displayKPIData.retentionRate.toFixed(2)}%</div>
          </div>
        </div>
      </div>

      {/* Donut Charts - Only render when charts are ready */}
      {chartsReady && (
        <div className="charts-row charts">
          <div className="chart-container">
            <h4>Total Customer by R Score</h4>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={rScoreData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, count }) => `${name}: ${count}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  isAnimationActive={false}
                >
                  {rScoreData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === 0 ? COLORS.orange : COLORS.purple} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-container">
            <h4>Total Customer by F Score</h4>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={fScoreData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, count }) => `${name}: ${count}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  isAnimationActive={false}
                >
                  {fScoreData.map((entry, index) => {
                    const colors = [COLORS.red, COLORS.orange, COLORS.yellow, COLORS.teal, COLORS.purple];
                    return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                  })}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-container">
            <h4>Total Customer by M Score</h4>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={mScoreData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, count }) => `${name}: ${count}`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  isAnimationActive={false}
                >
                  {mScoreData.map((entry, index) => {
                    const colors = [COLORS.purple, COLORS.yellow, COLORS.teal, COLORS.orange, COLORS.red];
                    return <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />;
                  })}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Horizontal Bar Charts - Only render when charts are ready */}
      {chartsReady && (
        <div className="charts-row charts">
          <div className="chart-container">
            <h4>Total Customer by R Value Bucket (Days)</h4>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={rValueBucketData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={100} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill={COLORS.primary} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-container">
            <h4>Total Customer by No. of Visits</h4>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={visitsData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={100} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill={COLORS.accent} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-container">
            <h4>Total Customer by Value</h4>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={valueData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={100} />
                <Tooltip />
                <Legend />
                <Bar dataKey="value" fill={COLORS.purple} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* New Charts Section - All three charts in same row - Only render when charts are ready */}
      {chartsReady && (
        <div className="charts-row charts charts1">
          <div className="chart-container treemap">
            <h4>Total Customer by Segment</h4>
            <ResponsiveContainer width="100%" height={350}>
              <Treemap
                width={400}
                height={350}
                data={segmentData}
                dataKey="value"
                ratio={4 / 3}
                stroke="#fff"
                fill="#8884d8"
                isAnimationActive={false}
              >
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div style={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          padding: '8px 12px',
                          border: '1px solid #ccc',
                          borderRadius: '4px',
                          boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                        }}>
                          <p style={{ margin: 0, fontWeight: 'bold', color: data.fill }}>{data.name}</p>
                          <p style={{ margin: '4px 0 0 0' }}>Count: {data.value?.toLocaleString()}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </Treemap>
            </ResponsiveContainer>
            <div className="treemap-legend" style={{ marginTop: '12px', display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center' }}>
              {segmentData.map((segment, index) => (
                <div key={index} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '16px', height: '16px', backgroundColor: segment.fill || '#8884d8', borderRadius: '2px' }}></div>
                  <span style={{ fontSize: '12px' }}>{segment.name}: {segment.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-container">
            <h4>Current Vs New Customer % (FY)</h4>
            <ResponsiveContainer width="100%" height={350}>
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
                  stroke="#1a1a1a"
                  strokeWidth={2}
                  name="Old Customer %"
                  dot={{ r: 5 }}
                  activeDot={{ r: 7 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-container">
            <h4>Days to Return Bucket</h4>
            <ResponsiveContainer width="100%" height={350}>
              <BarChart data={daysToReturnBucketData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="count" fill={COLORS.primary} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

