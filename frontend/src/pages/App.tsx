import { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";

import { ACCESS_TOKEN_KEY } from "@/constants/auth";
import ShellRoute from "../components/ShellRoute";
import Home from "./home/Home";
import Login from "./auth/Login";
import { AdminThemeProvider } from "./common/useAdminTheme";

// Lazy-load pages not needed on /login
const ClientList = lazy(() => import("./clients/ClientList"));
const ClientForm = lazy(() => import("./clients/ClientForm"));
const CompanyList = lazy(() => import("./companies/CompanyList"));
const CompanyForm = lazy(() => import("./companies/CompanyForm"));
const SalesOrderForm = lazy(() => import("./salesorder/SalesOrderForm"));
const ProductionEntryForm = lazy(() => import("./production/ProductionEntryForm"));
const DeliveryEntryForm = lazy(() => import("./delivery/DeliveryEntryForm"));
const ProductionReport = lazy(() => import("./reports/ProductionReport"));
const DeliveryReport = lazy(() => import("./reports/DeliveryReport"));
const SummaryReport = lazy(() => import("./reports/SummaryReport"));
const Campaign = lazy(() => import("./campaign/Campaign"));
const CampaignDashboard = lazy(() => import("./campaign/CampaignDashboard"));
const CampaignForm = lazy(() => import("./campaign/CampaignForm"));
const TemplateCreation = lazy(() => import("./template/TemplateCreation"));
const RunTemplate = lazy(() => import("./template/RunTemplate"));

function PrivateRoute() {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY);
  return token ? <Outlet /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<div>Loading...</div>}>
        <Routes>
          {/* public login */}
          <Route path="/login" element={<Login />} />
          {/* protected area */}
          <Route element={<PrivateRoute />}>
            <Route
              element={(
                <AdminThemeProvider>
                  <ShellRoute />
                </AdminThemeProvider>
              )}
            >
              <Route index element={<Home />} />
              <Route path="/clients" element={<ClientList />} />
              <Route path="/clients/new" element={<ClientForm />} />
              <Route path="/clients/:code" element={<ClientForm />} />
              <Route path="/companies" element={<CompanyList />} />
              <Route path="/companies/new" element={<CompanyForm />} />
              <Route path="/companies/:code" element={<CompanyForm />} />
              <Route path="/salesorder" element={<SalesOrderForm />} />
              <Route path="/salesorder/:soVoucherNo" element={<SalesOrderForm />} />
              <Route path="/production" element={<ProductionEntryForm />} />
              <Route path="/production/:soVoucherNo" element={<ProductionEntryForm />} />
              <Route path="/delivery" element={<DeliveryEntryForm />} />
              <Route path="/delivery/:soVoucherNo" element={<DeliveryEntryForm />} />
              <Route path="/reports/production" element={<ProductionReport />} />
              <Route path="/reports/delivery" element={<DeliveryReport />} />
              <Route path="/reports/summary" element={<SummaryReport />} />
              <Route path="/campaign" element={<Campaign />} />
              <Route path="/campaign/new" element={<CampaignForm />} />
              <Route path="/campaign/:id" element={<CampaignForm />} />
              <Route path="/campaign/dashboard" element={<CampaignDashboard />} />
              <Route path="/template/create" element={<TemplateCreation />} />
              <Route path="/template/run" element={<RunTemplate />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}