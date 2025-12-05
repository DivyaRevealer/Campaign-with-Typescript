# JavaScript to TypeScript Conversion Guide

This guide explains how to convert JavaScript screens from another project to match this IMS project's TypeScript structure.

## Project Structure Overview

```
frontend/src/
├── api/              # API client functions (TypeScript)
├── components/       # Reusable components
├── constants/        # Constants (auth, etc.)
├── pages/            # Screen/page components
│   ├── campaign/    # Example: Campaign screens
│   ├── clients/     # Client screens
│   └── ...
├── styles/           # Global styles
├── types/            # TypeScript type definitions
└── utils/            # Utility functions
```

## Key Conversion Requirements

### 1. **File Extensions**
- ✅ Change `.js` → `.tsx` (for React components)
- ✅ Change `.js` → `.ts` (for utilities/API files)

### 2. **TypeScript Types**

#### Component Props
```typescript
// ❌ JavaScript
function MyComponent(props) {
  return <div>{props.name}</div>;
}

// ✅ TypeScript
type MyComponentProps = {
  name: string;
  age?: number;
  onClose?: () => void;
};

function MyComponent({ name, age, onClose }: MyComponentProps) {
  return <div>{name}</div>;
}
```

#### State Types
```typescript
// ❌ JavaScript
const [data, setData] = useState(null);
const [items, setItems] = useState([]);

// ✅ TypeScript
const [data, setData] = useState<MyDataType | null>(null);
const [items, setItems] = useState<Item[]>([]);
```

#### API Response Types
```typescript
// ✅ Create interface for API responses
export interface Campaign {
  id: string;
  name: string;
  status: "active" | "inactive";
  created_at: string;
}

export interface CampaignListResponse {
  items: Campaign[];
  total: number;
}
```

### 3. **API Client Pattern**

#### Create API File: `frontend/src/api/campaign.ts`
```typescript
import http from "./http";

// Define types
export interface Campaign {
  id: string;
  name: string;
  // ... other fields
}

export interface CampaignListResponse {
  items: Campaign[];
  total: number;
}

// API functions
export const fetchCampaigns = (params: {
  q?: string;
  limit?: number;
  offset?: number;
}) => 
  http.get<CampaignListResponse>("/campaigns", { params })
    .then((r) => r.data);

export const getCampaign = (id: string) =>
  http.get<Campaign>(`/campaigns/${encodeURIComponent(id)}`)
    .then((r) => r.data);

export const createCampaign = (data: CampaignCreate) =>
  http.post<Campaign>("/campaigns", data)
    .then((r) => r.data);

export const updateCampaign = (id: string, data: CampaignUpdate) =>
  http.put<Campaign>(`/campaigns/${encodeURIComponent(id)}`, data)
    .then((r) => r.data);
```

**Key Points:**
- Use `http` from `./http` (not axios directly)
- All requests automatically include auth token
- Use TypeScript generics for response types
- Follow the pattern: `http.method<ResponseType>(url, options).then((r) => r.data)`

### 4. **Component Structure**

#### List Component Pattern
```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchCampaigns, type Campaign, type CampaignListResponse } from "../../api/campaign";
import "../common/adminTheme.css";

export default function CampaignList() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Campaign[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const limit = 10;
  const firstLoadRef = useRef(true);

  const load = useCallback(
    async (p = 0, search = q) => {
      const { items, total }: CampaignListResponse = await fetchCampaigns({
        q: search.trim(),
        limit,
        offset: p * limit,
      });
      setRows(items);
      setTotal(total);
      setPage(p);
    },
    [q]
  );

  useEffect(() => {
    if (firstLoadRef.current) {
      firstLoadRef.current = false;
      load(0, q);
      return;
    }
    const handle = window.setTimeout(() => load(0, q), 400);
    return () => window.clearTimeout(handle);
  }, [q, load]);

  return (
    <div className="admin-page">
      {/* Toolbar, table, pagination */}
    </div>
  );
}
```

#### Form Component Pattern
```typescript
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createCampaign, updateCampaign, getCampaign, type Campaign } from "../../api/campaign";
import { extractApiErrorMessage } from "../../api/errors";
import { focusNextFieldOnEnter } from "../common/formUtils";
import "../common/adminTheme.css";

type CampaignFormProps = {
  id?: string;
  onClose?: () => void;
  onSaved?: () => void;
};

export default function CampaignForm({ id, onClose, onSaved }: CampaignFormProps) {
  const navigate = useNavigate();
  const [formData, setFormData] = useState<CampaignFormState>(createEmptyForm());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing data if editing
  useEffect(() => {
    if (id) {
      // Load campaign data
    }
  }, [id]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (id) {
        await updateCampaign(id, formData);
      } else {
        await createCampaign(formData);
      }
      onSaved?.();
      onClose?.();
    } catch (err) {
      setError(extractApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} onKeyDown={focusNextFieldOnEnter}>
      {/* Form fields */}
    </form>
  );
}
```

### 5. **Import Paths**

Use path alias `@/` for `src/`:
```typescript
// ✅ Correct
import { ACCESS_TOKEN_KEY } from "@/constants/auth";
import http from "@/api/http";

// ❌ Avoid relative paths when possible
import { ACCESS_TOKEN_KEY } from "../../../constants/auth";
```

### 6. **Common Patterns**

#### Error Handling
```typescript
import { extractApiErrorMessage } from "../../api/errors";
import { isAxiosError } from "axios";

try {
  await someApiCall();
} catch (err) {
  if (isAxiosError(err)) {
    const message = extractApiErrorMessage(err);
    setError(message);
  }
}
```

#### Navigation
```typescript
import { useNavigate, useParams, Link } from "react-router-dom";

// In component
const navigate = useNavigate();
const { id } = useParams<{ id: string }>();

// Navigate programmatically
navigate("/campaign");

// Link component
<Link to={`/campaign/${id}`}>View</Link>
```

#### CSS Classes
- Use existing classes: `admin-page`, `admin-toolbar`, `admin-table`, etc.
- Import: `import "../common/adminTheme.css";`

### 7. **Routing Setup**

#### Add to `frontend/src/pages/App.tsx`:
```typescript
// Lazy import
const CampaignList = lazy(() => import("./campaign/CampaignList"));
const CampaignForm = lazy(() => import("./campaign/CampaignForm"));

// Add route
<Route path="/campaign" element={<CampaignList />} />
<Route path="/campaign/new" element={<CampaignForm />} />
<Route path="/campaign/:id" element={<CampaignForm />} />
```

#### Add to Sidebar (`frontend/src/components/Sidebar.tsx`):
```typescript
<Link
  to="/campaign"
  className={isActive("/campaign") ? "active" : ""}
  title={collapsed ? "Campaign" : undefined}
>
  <span className="ico" aria-hidden="true">📢</span>
  <span className="label">Campaign</span>
</Link>
```

## Checklist for Converting a Screen

- [ ] Convert `.js` → `.tsx` or `.ts`
- [ ] Add TypeScript types for all props, state, and API responses
- [ ] Create API file in `frontend/src/api/` following the pattern
- [ ] Update imports to use TypeScript types
- [ ] Use `http` from `./http` for API calls (not axios directly)
- [ ] Add error handling with `extractApiErrorMessage`
- [ ] Use `focusNextFieldOnEnter` for form keyboard navigation
- [ ] Import `adminTheme.css` for styling
- [ ] Add route in `App.tsx`
- [ ] Add navigation link in `Sidebar.tsx` (if needed)
- [ ] Test TypeScript compilation (no errors)

## Example: Complete Conversion

See existing files for reference:
- **List Component**: `frontend/src/pages/clients/ClientList.tsx`
- **Form Component**: `frontend/src/pages/clients/ClientForm.tsx`
- **API File**: `frontend/src/api/clients.ts`

## Need Help?

If you provide the JavaScript screen files, I can help convert them to match this project's structure!

