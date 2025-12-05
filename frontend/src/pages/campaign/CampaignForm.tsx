import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { useNavigate, useParams } from "react-router-dom";
import {
  createCampaign,
  getCampaign,
  updateCampaign,
  getCampaignOptions,
  countCampaignCustomers,
  type Campaign,
  type CampaignCreate,
  type CampaignUpdate,
  type CampaignOptions,
  type CampaignCountRequest,
} from "../../api/campaign";
import { extractApiErrorMessage } from "../../api/errors";
import "../common/adminTheme.css";
import "./CampaignForm.css";

type CampaignFormProps = {
  id?: number;
  onClose?: () => void;
  onSaved?: () => void;
};

// Form state matching the reference file structure
type CampaignFormState = {
  name: string;
  campaignPeriod: [string, string] | null; // [start, end] as date strings
  basedOn: "Customer Base" | "upload";
  rfmMode?: { customized?: boolean; segmented?: boolean };
  recencyOp?: string;
  recencyMin?: number;
  recencyMax?: number;
  frequencyOp?: string;
  frequencyMin?: number;
  frequencyMax?: number;
  monetaryOp?: string;
  monetaryMin?: number;
  monetaryMax?: number;
  rScore?: number[];
  fScore?: number[];
  mScore?: number[];
  rfmSegment?: string[];
  branch?: string[];
  city?: string[];
  state?: string[];
  birthdayRange?: [string, string] | null;
  anniversaryRange?: [string, string] | null;
  purchaseType?: { anyPurchase?: boolean; recentPurchase?: boolean };
  purchaseBrand?: string[];
  section?: string[];
  product?: string[];
  model?: string[];
  item?: string[];
  valueThreshold?: number;
  uploadFile?: File | null;
};

const createEmptyForm = (): CampaignFormState => ({
  name: "",
  campaignPeriod: null,
  basedOn: "Customer Base",
  rfmMode: undefined,
  recencyOp: undefined,
  recencyMin: undefined,
  recencyMax: undefined,
  frequencyOp: undefined,
  frequencyMin: undefined,
  frequencyMax: undefined,
  monetaryOp: undefined,
  monetaryMin: undefined,
  monetaryMax: undefined,
  rScore: undefined,
  fScore: undefined,
  mScore: undefined,
  rfmSegment: undefined,
  branch: undefined,
  city: undefined,
  state: undefined,
  birthdayRange: null,
  anniversaryRange: null,
  purchaseType: undefined,
  purchaseBrand: undefined,
  section: undefined,
  product: undefined,
  model: undefined,
  item: undefined,
  valueThreshold: undefined,
  uploadFile: null,
});

// Helper functions matching reference
const parseArr = <T,>(v: unknown): T[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const stripQuotes = (v: unknown): string => {
  if (typeof v === "string") {
    return v.replace(/^['"]+|['"]+$/g, "");
  }
  return String(v || "");
};

const toDateRange = (s: string | undefined, e: string | undefined): [string, string] | null => {
  const cleanS = s ? stripQuotes(s) : "";
  const cleanE = e ? stripQuotes(e) : "";
  if (cleanS && cleanE) {
    return [cleanS, cleanE];
  }
  return null;
};

export default function CampaignForm({ id: idProp, onClose, onSaved }: CampaignFormProps = {}) {
  const params = useParams<{ id: string }>();
  const id = idProp ?? (params.id ? parseInt(params.id, 10) : undefined);
  const isEditing = !!id;
  const nav = useNavigate();

  const [form, setForm] = useState<CampaignFormState>(() => createEmptyForm());
  const [options, setOptions] = useState<CampaignOptions | null>(null);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Watch values for dependent filtering (matching reference)
  const watchBasedOn = form.basedOn || "Customer Base";
  const watchName = form.name || "";
  const watchBranch = form.branch || [];
  const watchCity = form.city || [];
  const watchState = form.state || [];
  const watchPurchaseBrand = form.purchaseBrand || [];
  const watchSection = form.section || [];
  const watchProduct = form.product || [];
  const watchModel = form.model || [];
  const watchItem = form.item || [];
  const watchValueThreshold = form.valueThreshold;

  const requirePurchaseType =
    (watchPurchaseBrand && watchPurchaseBrand.length > 0) ||
    (watchSection && watchSection.length > 0) ||
    (watchProduct && watchProduct.length > 0) ||
    (watchModel && watchModel.length > 0) ||
    (watchItem && watchItem.length > 0) ||
    !!watchValueThreshold;

  // Load options
  useEffect(() => {
    console.log("Loading campaign options...");
    getCampaignOptions()
      .then((data) => {
        console.log("Campaign options loaded successfully:", data);
        console.log("Branches:", data.branches);
        console.log("RFM Segments:", data.rfm_segments);
        console.log("R Scores:", data.r_scores);
        // Ensure R/F/M scores have defaults if empty
        const optionsWithDefaults = {
          ...data,
          r_scores: data.r_scores && data.r_scores.length > 0 ? data.r_scores : [1, 2, 3, 4, 5],
          f_scores: data.f_scores && data.f_scores.length > 0 ? data.f_scores : [1, 2, 3, 4, 5],
          m_scores: data.m_scores && data.m_scores.length > 0 ? data.m_scores : [1, 2, 3, 4, 5],
          branches: data.branches || [],
          rfm_segments: data.rfm_segments || [],
          branch_city_map: data.branch_city_map || {},
          branch_state_map: data.branch_state_map || {},
          brands: data.brands || [],
          sections: data.sections || [],
          products: data.products || [],
          models: data.models || [],
          items: data.items || [],
          brand_hierarchy: data.brand_hierarchy || [],
        };
        console.log("Options with defaults:", optionsWithDefaults);
        setOptions(optionsWithDefaults);
        setOptionsLoaded(true);
        setErrorMsg(""); // Clear any previous errors
      })
      .catch((err) => {
        console.error("Failed to load filter options:", err);
        console.error("Error details:", err.response?.data || err.message);
        console.error("Error status:", err.response?.status);
        console.error("Error URL:", err.config?.url);
        
        const errorMessage = extractApiErrorMessage(err, "Failed to load filter options");
        // Don't show error if it's just empty data - use defaults instead
        if (err.response?.status === 404) {
          console.warn("Options endpoint returned 404 - using default values");
        } else {
          setErrorMsg(errorMessage);
        }
        
        // Set default options so form can still be used
        setOptions({
          r_scores: [1, 2, 3, 4, 5],
          f_scores: [1, 2, 3, 4, 5],
          m_scores: [1, 2, 3, 4, 5],
          rfm_segments: [],
          branches: [],
          branch_city_map: {},
          branch_state_map: {},
          brands: [],
          sections: [],
          products: [],
          models: [],
          items: [],
          brand_hierarchy: [],
        });
        setOptionsLoaded(true); // Allow form to render even with empty options
      });
  }, []);

  // Load campaign for edit
  useEffect(() => {
    if (!id) return;

    getCampaign(id)
      .then((data) => {
        const campaignPeriod = toDateRange(data.start_date, data.end_date);
        const birthdayRange = toDateRange(data.birthday_start, data.birthday_end);
        const anniversaryRange = toDateRange(data.anniversary_start, data.anniversary_end);

        setForm({
          name: data.name,
          campaignPeriod,
          basedOn: data.based_on === "upload" ? "upload" : "Customer Base",
          recencyOp: typeof data.recency_op === "string" ? data.recency_op : undefined,
          recencyMin: data.recency_min,
          recencyMax: data.recency_max,
          frequencyOp: typeof data.frequency_op === "string" ? data.frequency_op : undefined,
          frequencyMin: data.frequency_min,
          frequencyMax: data.frequency_max,
          monetaryOp: typeof data.monetary_op === "string" ? data.monetary_op : undefined,
          monetaryMin: data.monetary_min,
          monetaryMax: data.monetary_max,
          rScore: parseArr<number>(data.r_score),
          fScore: parseArr<number>(data.f_score),
          mScore: parseArr<number>(data.m_score),
          rfmSegment: parseArr<string>(data.rfm_segments),
          branch: parseArr<string>(data.branch),
          city: parseArr<string>(data.city),
          state: parseArr<string>(data.state),
          birthdayRange,
          anniversaryRange,
          purchaseType: {
            anyPurchase: data.purchase_type === "any",
            recentPurchase: data.purchase_type === "recent",
          },
          purchaseBrand: parseArr<string>(data.purchase_brand),
          section: parseArr<string>(data.section),
          product: parseArr<string>(data.product),
          model: parseArr<string>(data.model),
          item: parseArr<string>(data.item),
          valueThreshold: data.value_threshold,
          rfmMode: {
            customized: data.rfm_mode === "customized",
            segmented: data.rfm_mode === "segmented",
          },
          uploadFile: null,
        });
      })
      .catch(() => {
        setErrorMsg("Failed to load campaign details");
      });
  }, [id]);

  // Compute geography options (matching reference logic)
  const computeGeoOptions = () => {
    if (!options) {
      console.warn("computeGeoOptions: options is null");
      return { allowedBranches: [], allowedCities: [], allowedStates: [] };
    }

    const { branches, branch_city_map, branch_state_map } = options;
    console.log("computeGeoOptions - branches:", branches, "branch_city_map:", branch_city_map);

    const allowedBranches = branches.filter((b) => {
      const cities = branch_city_map?.[b] || [];
      const states = branch_state_map?.[b] || [];
      const cityOK = watchCity.length ? watchCity.some((c) => cities.includes(c)) : true;
      const stateOK = watchState.length ? watchState.some((s) => states.includes(s)) : true;
      return cityOK && stateOK;
    });

    const allCitiesFromAllowedBranches = new Set(
      ((watchBranch.length ? watchBranch : allowedBranches).flatMap((b) => branch_city_map?.[b] || []))
    );
    const allowedCities = Array.from(allCitiesFromAllowedBranches).filter((c) =>
      watchState.length
        ? allowedBranches.some(
            (b) =>
              (branch_city_map?.[b] || []).includes(c) &&
              (branch_state_map?.[b] || []).some((s) => watchState.includes(s))
          )
        : true
    );

    const allStatesFromAllowedBranches = new Set(
      ((watchBranch.length ? watchBranch : allowedBranches).flatMap((b) => branch_state_map?.[b] || []))
    );
    const allowedStates = Array.from(allStatesFromAllowedBranches).filter((s) =>
      watchCity.length
        ? allowedBranches.some(
            (b) =>
              (branch_state_map?.[b] || []).includes(s) &&
              (branch_city_map?.[b] || []).some((c) => watchCity.includes(c))
          )
        : true
    );

    return { allowedBranches, allowedCities, allowedStates };
  };

  // Compute brand options (matching reference logic)
  const computeBrandOptions = () => {
    if (!options || !options.brand_hierarchy.length) {
      return {
        allowedBrands: [],
        allowedSections: [],
        allowedProducts: [],
        allowedModels: [],
        allowedItems: [],
      };
    }

    let filtered = options.brand_hierarchy;

    if (watchPurchaseBrand.length) {
      filtered = filtered.filter((r) => watchPurchaseBrand.includes(r.brand));
    }
    if (watchSection.length) {
      filtered = filtered.filter((r) => watchSection.includes(r.section));
    }
    if (watchProduct.length) {
      filtered = filtered.filter((r) => watchProduct.includes(r.product));
    }
    if (watchModel.length) {
      filtered = filtered.filter((r) => watchModel.includes(r.model));
    }
    if (watchItem.length) {
      filtered = filtered.filter((r) => watchItem.includes(r.item));
    }

    const allowedBrands = [...new Set(filtered.map((r) => r.brand))];
    const allowedSections = [...new Set(filtered.map((r) => r.section))];
    const allowedProducts = [...new Set(filtered.map((r) => r.product))];
    const allowedModels = [...new Set(filtered.map((r) => r.model))];
    const allowedItems = [...new Set(filtered.map((r) => r.item))];

    return { allowedBrands, allowedSections, allowedProducts, allowedModels, allowedItems };
  };

  // Prune geography selections when dependencies change
  useEffect(() => {
    if (!optionsLoaded) return;

    const { allowedBranches, allowedCities, allowedStates } = computeGeoOptions();
    const pruned = {
      branch: watchBranch.filter((b) => allowedBranches.includes(b)),
      city: watchCity.filter((c) => allowedCities.includes(c)),
      state: watchState.filter((s) => allowedStates.includes(s)),
    };

    if (
      pruned.branch.length !== watchBranch.length ||
      pruned.city.length !== watchCity.length ||
      pruned.state.length !== watchState.length
    ) {
      setForm((prev) => ({
        ...prev,
        branch: pruned.branch.length > 0 ? pruned.branch : undefined,
        city: pruned.city.length > 0 ? pruned.city : undefined,
        state: pruned.state.length > 0 ? pruned.state : undefined,
      }));
    }
  }, [watchBranch, watchCity, watchState, optionsLoaded, options]);

  // Prune brand hierarchy selections when dependencies change
  useEffect(() => {
    if (!optionsLoaded || !options?.brand_hierarchy?.length) return;

    const { allowedBrands, allowedSections, allowedProducts, allowedModels, allowedItems } = computeBrandOptions();
    const pruned = {
      purchaseBrand: watchPurchaseBrand.filter((b) => allowedBrands.includes(b)),
      section: watchSection.filter((s) => allowedSections.includes(s)),
      product: watchProduct.filter((p) => allowedProducts.includes(p)),
      model: watchModel.filter((m) => allowedModels.includes(m)),
      item: watchItem.filter((i) => allowedItems.includes(i)),
    };

    if (
      pruned.purchaseBrand.length !== watchPurchaseBrand.length ||
      pruned.section.length !== watchSection.length ||
      pruned.product.length !== watchProduct.length ||
      pruned.model.length !== watchModel.length ||
      pruned.item.length !== watchItem.length
    ) {
      setForm((prev) => ({
        ...prev,
        purchaseBrand: pruned.purchaseBrand.length > 0 ? pruned.purchaseBrand : undefined,
        section: pruned.section.length > 0 ? pruned.section : undefined,
        product: pruned.product.length > 0 ? pruned.product : undefined,
        model: pruned.model.length > 0 ? pruned.model : undefined,
        item: pruned.item.length > 0 ? pruned.item : undefined,
      }));
    }
  }, [watchPurchaseBrand, watchSection, watchProduct, watchModel, watchItem, optionsLoaded, options]);

  // Multi-select dropdown component (matching reference)
  const MultiSelectDropdown = ({
    name,
    label,
    optionsProvider,
    placeholder,
    disabled,
  }: {
    name: string;
    label: string;
    optionsProvider: () => string[];
    placeholder: string;
    disabled?: boolean;
  }) => {
    const allowed = optionsProvider();
    const selected = (() => {
      if (name === "branch") return form.branch || [];
      if (name === "city") return form.city || [];
      if (name === "state") return form.state || [];
      if (name === "purchaseBrand") return form.purchaseBrand || [];
      if (name === "section") return form.section || [];
      if (name === "product") return form.product || [];
      if (name === "model") return form.model || [];
      if (name === "item") return form.item || [];
      if (name === "rfmSegment") return form.rfmSegment || [];
      return [];
    })();
    const ALL = "__ALL__";
    const [isOpen, setIsOpen] = useState(false);

    const handleChange = (vals: string[]) => {
      if (vals.includes(ALL) && !selected.includes(ALL)) {
        const newValue = [...allowed];
        setForm((prev) => ({ ...prev, [name]: newValue }));
        return;
      }
      const filtered = vals.filter((v) => v !== ALL);
      setForm((prev) => ({ ...prev, [name]: filtered.length > 0 ? filtered : undefined }));
    };

    const isAllSelected = allowed.length > 0 && selected.length === allowed.length;

    return (
      <div className="form-field">
        <label>{label}</label>
        <div className="multi-select-wrapper">
          <div className="multi-select" onClick={() => !disabled && setIsOpen(!isOpen)}>
            <div className="multi-select-display">
              {selected.length === 0
                ? placeholder
                : isAllSelected
                  ? `All (${selected.length})`
                  : `${selected.length} selected`}
            </div>
            {isOpen && !disabled && (
              <div className="multi-select-dropdown">
                <div
                  className="multi-select-option"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleChange(isAllSelected ? [] : [...allowed, ALL]);
                  }}
                >
                  <input type="checkbox" checked={isAllSelected} readOnly />
                  <span>{isAllSelected ? "All (selected)" : "All"}</span>
                </div>
                {allowed.map((v) => (
                  <div
                    key={v}
                    className="multi-select-option"
                    onClick={(e) => {
                      e.stopPropagation();
                      const newVals = selected.includes(v)
                        ? selected.filter((s) => s !== v)
                        : [...selected, v];
                      handleChange(newVals);
                    }}
                  >
                    <input type="checkbox" checked={selected.includes(v)} readOnly />
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Multi-select component for R/F/M scores (handles number arrays)
  const MultiSelect = ({
    name,
    label,
    allowed,
    selected,
    setForm,
    placeholder,
    disabled,
  }: {
    name: "rScore" | "fScore" | "mScore";
    label: string;
    allowed: string[];
    selected: string[];
    setForm: React.Dispatch<React.SetStateAction<CampaignFormState>>;
    placeholder: string;
    disabled?: boolean;
  }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
      };
    }, []);

    const handleToggle = (val: string) => {
      const numVal = parseInt(val, 10);
      const currentNums = selected.map((s) => parseInt(s, 10));
      const newNums = currentNums.includes(numVal)
        ? currentNums.filter((n) => n !== numVal)
        : [...currentNums, numVal];
      setForm((prev) => ({
        ...prev,
        [name]: newNums.length > 0 ? newNums : undefined,
      }));
    };

    const handleSelectAll = () => {
      const allNums = allowed.map((a) => parseInt(a, 10));
      const isAllSelected = allowed.length > 0 && selected.length === allowed.length;
      setForm((prev) => ({
        ...prev,
        [name]: isAllSelected ? undefined : allNums,
      }));
    };

    const isAllSelected = allowed.length > 0 && selected.length === allowed.length;

    return (
      <div className="form-field" style={{ marginBottom: 0 }}>
        <label>{label}</label>
        <div className="multi-select-wrapper" ref={dropdownRef}>
          <div className={`multi-select ${disabled ? "disabled" : ""}`} onClick={() => !disabled && setIsOpen(!isOpen)}>
            <div className="multi-select-display">
              {selected.length === 0
                ? placeholder
                : isAllSelected
                  ? `All (${selected.length})`
                  : `${selected.length} selected`}
            </div>
            {isOpen && !disabled && (
              <div className="multi-select-dropdown">
                <div className="multi-select-option" onClick={(e) => { e.stopPropagation(); handleSelectAll(); }}>
                  <input type="checkbox" checked={isAllSelected} readOnly />
                  <span>All</span>
                </div>
                {allowed.map((val) => (
                  <div
                    key={val}
                    className="multi-select-option"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle(val);
                    }}
                  >
                    <input type="checkbox" checked={selected.includes(val)} readOnly />
                    <span>{val}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // Build payload for API (matching reference logic)
  const buildPayload = (): CampaignCreate => {
    const [startMoment, endMoment] = form.campaignPeriod || ["", ""];

    const payload: CampaignCreate = {
      name: form.name,
      start_date: startMoment,
      end_date: endMoment,
      based_on: form.basedOn,
    };

    if (form.basedOn !== "upload") {
      Object.assign(payload, {
        based_on: form.basedOn,
        recency_op: form.recencyOp,
        recency_min: form.recencyMin,
        recency_max: form.recencyOp === "between" ? form.recencyMax : form.recencyMin,
        frequency_op: form.frequencyOp,
        frequency_min: form.frequencyMin,
        frequency_max: form.frequencyOp === "between" ? form.frequencyMax : form.frequencyMin,
        monetary_op: form.monetaryOp,
        monetary_min: form.monetaryMin,
        monetary_max: form.monetaryOp === "between" ? form.monetaryMax : form.monetaryMin,
        r_score: form.rScore,
        f_score: form.fScore,
        m_score: form.mScore,
        branch: form.branch,
        city: form.city,
        state: form.state,
        birthday_start: form.birthdayRange?.[0],
        birthday_end: form.birthdayRange?.[1],
        anniversary_start: form.anniversaryRange?.[0],
        anniversary_end: form.anniversaryRange?.[1],
        purchase_brand: form.purchaseBrand,
        section: form.section,
        product: form.product,
        model: form.model,
        item: form.item,
        value_threshold: form.valueThreshold,
      });

      if (form.purchaseType?.anyPurchase) {
        payload.purchase_type = "any";
      }
      if (form.purchaseType?.recentPurchase) {
        payload.purchase_type = "recent";
      }
      if (form.rfmMode?.customized) {
        payload.rfm_mode = "customized";
      }
      if (form.rfmMode?.segmented) {
        payload.rfm_mode = "segmented";
        payload.rfm_segments = form.rfmSegment;
      }
    } else {
      Object.assign(payload, {
        recency_op: "=",
        frequency_op: "=",
        monetary_op: "=",
      });
    }

    return payload;
  };

  const handleCheckAndCreate = async () => {
    try {
      const payload: CampaignCountRequest = {
        name: form.name,
        start_date: form.campaignPeriod?.[0],
        end_date: form.campaignPeriod?.[1],
        based_on: form.basedOn,
        recency_op: form.recencyOp,
        recency_min: form.recencyMin,
        recency_max: form.recencyMax,
        frequency_op: form.frequencyOp,
        frequency_min: form.frequencyMin,
        frequency_max: form.frequencyMax,
        monetary_op: form.monetaryOp,
        monetary_min: form.monetaryMin,
        monetary_max: form.monetaryMax,
        r_score: form.rScore,
        f_score: form.fScore,
        m_score: form.mScore,
        rfm_segments: form.rfmSegment,
        branch: form.branch,
        city: form.city,
        state: form.state,
        birthday_start: form.birthdayRange?.[0],
        birthday_end: form.birthdayRange?.[1],
        anniversary_start: form.anniversaryRange?.[0],
        anniversary_end: form.anniversaryRange?.[1],
        purchase_type: form.purchaseType?.anyPurchase ? "any" : form.purchaseType?.recentPurchase ? "recent" : undefined,
        purchase_brand: form.purchaseBrand,
        section: form.section,
        product: form.product,
        model: form.model,
        item: form.item,
        value_threshold: form.valueThreshold,
        rfm_mode: form.rfmMode?.customized ? "customized" : form.rfmMode?.segmented ? "segmented" : undefined,
      };

      const res = await countCampaignCustomers(payload);
      const { total_customers, shortlisted_customers } = res;

      const proceed = window.confirm(
        `Confirm Campaign Creation\n\n` +
        `Total Customers: ${total_customers}\n` +
        `Shortlisted Customers: ${shortlisted_customers}\n\n` +
        `Do you want to proceed with creating the campaign?`
      );

      if (proceed) {
        await handleSubmit();
      }
    } catch (err) {
      setErrorMsg(extractApiErrorMessage(err, "Failed to fetch customer counts"));
    }
  };

  const handleSubmit = async () => {
    setLoading(true);
    setErrorMsg("");

    try {
      const payload = buildPayload();

      let resp;
      if (id) {
        const current = await getCampaign(id);
        const updatePayload: CampaignUpdate = {
          ...payload,
          expected_updated_at: current.updated_at,
        };
        resp = await updateCampaign(id, updatePayload);
        setErrorMsg("Campaign updated successfully");
      } else {
        resp = await createCampaign(payload);
        setErrorMsg("Campaign saved successfully");
        setForm(createEmptyForm());
      }

      const newId = id || resp?.id;
      if (form.basedOn === "upload" && uploadFile && newId) {
        try {
          const formData = new FormData();
          formData.append("file", uploadFile);
          // TODO: Implement upload endpoint
          // await api.post(`/campaign/${newId}/upload`, formData, {
          //   headers: { 'Content-Type': 'multipart/form-data' },
          // });
          setErrorMsg("Campaign saved. Upload functionality to be implemented.");
        } catch (uploadErr) {
          console.error("Upload failed:", uploadErr);
          if (!id) {
            try {
              // TODO: Implement delete endpoint
              // await api.delete(`/campaign/${newId}`);
              setErrorMsg("Upload failed. Please check manually.");
            } catch (rollbackErr) {
              setErrorMsg("Upload failed, and rollback could not be completed.");
            }
          } else {
            setErrorMsg("Upload failed. Campaign not reverted since it was an update.");
          }
        }
      }

      if (onSaved) {
        onSaved();
      } else if (!id) {
        // Clear form after create
        setTimeout(() => {
          nav("/campaign");
        }, 1500);
      }
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 409 && id) {
        setErrorMsg("This campaign was updated by someone else. Please reload and try again.");
        return;
      }
      setErrorMsg(extractApiErrorMessage(err, "Failed to save campaign"));
    } finally {
      setLoading(false);
    }
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await handleSubmit();
  };

  const geoOptions = computeGeoOptions();
  const brandOptions = computeBrandOptions();
  
  // Debug logging for options
  useEffect(() => {
    if (optionsLoaded) {
      console.log("=== Options Debug ===");
      console.log("Options object:", options);
      console.log("Branches:", options?.branches);
      console.log("RFM Segments:", options?.rfm_segments);
      console.log("Geo Options:", geoOptions);
      console.log("Brand Options:", brandOptions);
      console.log("===================");
    }
  }, [optionsLoaded, options, geoOptions, brandOptions]);
  
  const rfmMode = form.rfmMode || {};
  const isCustomized = rfmMode.customized === true;
  const isSegmented = rfmMode.segmented === true;

  return (
    <div className="campaign-form-wrapper" style={{ fontWeight: "bold", padding: 5, minHeight: "50vh" }}>
      <h2 className="campaign-form-title">{isEditing ? "Update Campaign" : "Create Campaign"}</h2>

      <form className="campaign-form" onSubmit={submit} style={{ maxWidth: 1360, margin: "0 auto" }}>
        {errorMsg && (
          <div className={`message-banner ${errorMsg.includes("successfully") ? "success" : "error"}`}>
            {errorMsg}
          </div>
        )}

        {/* First Row: Name, Period, Based On - matching reference exact layout */}
        <div className="campaign-form-row" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <div className="campaign-form-col" style={{ flex: "0 0 180px" }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                required
                placeholder="Enter campaign name"
              />
            </div>
          </div>
          <div className="campaign-form-col" style={{ flex: "0 0 500px" }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>Period</label>
              <div className="date-range-picker">
                <input
                  type="date"
                  value={form.campaignPeriod?.[0] || ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      campaignPeriod: [e.target.value, prev.campaignPeriod?.[1] || ""],
                    }))
                  }
                  required
                />
                <span>to</span>
                <input
                  type="date"
                  value={form.campaignPeriod?.[1] || ""}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      campaignPeriod: [prev.campaignPeriod?.[0] || "", e.target.value],
                    }))
                  }
                  required
                  min={form.campaignPeriod?.[0]}
                />
              </div>
            </div>
          </div>
          <div className="campaign-form-col" style={{ flex: 1 }}>
            <div className="form-field" style={{ marginBottom: 0 }}>
              <label>Campaign Based On</label>
              <div className="radio-group-inline">
                <label>
                  <input
                    type="radio"
                    name="basedOn"
                    value="Customer Base"
                    checked={form.basedOn === "Customer Base"}
                    onChange={(e) => setForm((prev) => ({ ...prev, basedOn: e.target.value as "Customer Base" | "upload" }))}
                  />
                  <span>Customer Base</span>
                </label>
                <label>
                  <input
                    type="radio"
                    name="basedOn"
                    value="upload"
                    checked={form.basedOn === "upload"}
                    onChange={(e) => setForm((prev) => ({ ...prev, basedOn: e.target.value as "Customer Base" | "upload" }))}
                  />
                  <span>Upload</span>
                </label>
              </div>
            </div>
          </div>
        </div>

        {watchBasedOn === "Customer Base" && optionsLoaded && (
          <>
            {/* Geography - matching reference exact layout */}
            <div className="campaign-form-row" style={{ display: "flex", gap: 16, marginBottom: 16 }}>
              <div className="campaign-form-col" style={{ flex: "0 0 180px" }}>
                <MultiSelectDropdown
                  name="branch"
                  label="Branch"
                  placeholder="Select branches"
                  optionsProvider={() => geoOptions.allowedBranches}
                  disabled={watchBasedOn === "upload"}
                />
              </div>
              <div className="campaign-form-col" style={{ flex: "0 0 180px", maxWidth: "180px" }}>
                <MultiSelectDropdown
                  name="city"
                  label="City"
                  placeholder="Select cities"
                  optionsProvider={() => geoOptions.allowedCities}
                  disabled={watchBasedOn === "upload"}
                />
              </div>
              <div className="campaign-form-col" style={{ flex: "0 0 180px", maxWidth: "180px" }}>
                <MultiSelectDropdown
                  name="state"
                  label="State"
                  placeholder="Select states"
                  optionsProvider={() => geoOptions.allowedStates}
                  disabled={watchBasedOn === "upload"}
                />
              </div>
            </div>

            {/* RFM Mode - matching reference exact layout */}
            <div className="campaign-form-row" style={{ display: "flex", gap: 16, marginTop: 8, marginBottom: 16 }}>
              <div className="form-field">
                <div className="switch-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={isCustomized}
                      onChange={(e) => {
                        setForm((prev) => ({
                          ...prev,
                          rfmMode: { customized: e.target.checked, segmented: !e.target.checked },
                        }));
                      }}
                    />
                    <span className="switch-label">RFM Customized</span>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={isSegmented}
                      onChange={(e) => {
                        setForm((prev) => ({
                          ...prev,
                          rfmMode: { customized: !e.target.checked, segmented: e.target.checked },
                        }));
                      }}
                    />
                    <span className="switch-label">RFM Segmented</span>
                  </label>
                </div>
              </div>
            </div>

            {/* RFM Customized - matching reference exact horizontal scroll layout */}
            {isCustomized && (
              <div className="rfm-customized-card" style={{ marginTop: 5, padding: 10, borderRadius: 8 }}>
                <div
                  className="rfm-customized-row"
                  style={{
                    display: "flex",
                    gap: 4,
                    alignItems: "flex-start",
                    flexWrap: "wrap",
                  }}
                >
                  {/* Recency */}
                  <div style={{ flex: "0 0 190px" }}>
                    <div className="form-field" style={{ marginBottom: 0 }}>
                      <label>Recency</label>
                      <div className="operator-input-group">
                        <select
                          value={form.recencyOp || ""}
                          onChange={(e) => setForm((prev) => ({ ...prev, recencyOp: e.target.value || undefined }))}
                        >
                          <option value="">Op</option>
                          <option value="=">=</option>
                          <option value=">=">≥</option>
                          <option value="<=">≤</option>
                          <option value="between">Between</option>
                        </select>
                        {form.recencyOp === "between" ? (
                          <>
                            <input
                              type="number"
                              value={form.recencyMin || ""}
                              onChange={(e) =>
                                setForm((prev) => ({ ...prev, recencyMin: e.target.value ? parseInt(e.target.value, 10) : undefined }))
                              }
                              placeholder="Min"
                              style={{ width: 85 }}
                            />
                            <input
                              type="number"
                              value={form.recencyMax || ""}
                              onChange={(e) =>
                                setForm((prev) => ({ ...prev, recencyMax: e.target.value ? parseInt(e.target.value, 10) : undefined }))
                              }
                              placeholder="Max"
                              style={{ width: 85 }}
                            />
                          </>
                        ) : (
                          <input
                            type="number"
                            value={form.recencyMin || ""}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, recencyMin: e.target.value ? parseInt(e.target.value, 10) : undefined }))
                            }
                            placeholder="Value"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Frequency */}
                  <div style={{ flex: "0 0 190px" }}>
                    <div className="form-field" style={{ marginBottom: 0 }}>
                      <label>Frequency</label>
                      <div className="operator-input-group">
                        <select
                          value={form.frequencyOp || ""}
                          onChange={(e) => setForm((prev) => ({ ...prev, frequencyOp: e.target.value || undefined }))}
                        >
                          <option value="">Op</option>
                          <option value="=">=</option>
                          <option value=">=">≥</option>
                          <option value="<=">≤</option>
                          <option value="between">Between</option>
                        </select>
                        {form.frequencyOp === "between" ? (
                          <>
                            <input
                              type="number"
                              value={form.frequencyMin || ""}
                              onChange={(e) =>
                                setForm((prev) => ({ ...prev, frequencyMin: e.target.value ? parseInt(e.target.value, 10) : undefined }))
                              }
                              placeholder="Min"
                              style={{ width: 85 }}
                            />
                            <input
                              type="number"
                              value={form.frequencyMax || ""}
                              onChange={(e) =>
                                setForm((prev) => ({ ...prev, frequencyMax: e.target.value ? parseInt(e.target.value, 10) : undefined }))
                              }
                              placeholder="Max"
                              style={{ width: 85 }}
                            />
                          </>
                        ) : (
                          <input
                            type="number"
                            value={form.frequencyMin || ""}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, frequencyMin: e.target.value ? parseInt(e.target.value, 10) : undefined }))
                            }
                            placeholder="Value"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Monetary */}
                  <div style={{ flex: "0 0 190px" }}>
                    <div className="form-field" style={{ marginBottom: 0 }}>
                      <label>Monetary (₹)</label>
                      <div className="operator-input-group">
                        <select
                          value={form.monetaryOp || ""}
                          onChange={(e) => setForm((prev) => ({ ...prev, monetaryOp: e.target.value || undefined }))}
                        >
                          <option value="">Op</option>
                          <option value="=">=</option>
                          <option value=">=">≥</option>
                          <option value="<=">≤</option>
                          <option value="between">Between</option>
                        </select>
                        {form.monetaryOp === "between" ? (
                          <>
                            <input
                              type="number"
                              value={form.monetaryMin || ""}
                              onChange={(e) =>
                                setForm((prev) => ({ ...prev, monetaryMin: e.target.value ? parseFloat(e.target.value) : undefined }))
                              }
                              placeholder="Min"
                              step="0.01"
                              style={{ width: 85 }}
                            />
                            <input
                              type="number"
                              value={form.monetaryMax || ""}
                              onChange={(e) =>
                                setForm((prev) => ({ ...prev, monetaryMax: e.target.value ? parseFloat(e.target.value) : undefined }))
                              }
                              placeholder="Max"
                              step="0.01"
                              style={{ width: 85 }}
                            />
                          </>
                        ) : (
                          <input
                            type="number"
                            value={form.monetaryMin || ""}
                            onChange={(e) =>
                              setForm((prev) => ({ ...prev, monetaryMin: e.target.value ? parseFloat(e.target.value) : undefined }))
                            }
                            placeholder="Value"
                            step="0.01"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* R-Score */}
                  {optionsLoaded && options && (
                    <>
                      <div style={{ flex: "0 0 180px" }}>
                        <MultiSelect
                          name="rScore"
                          label="R-Score"
                          allowed={(options.r_scores || [1, 2, 3, 4, 5]).map(String)}
                          selected={(form.rScore || []).map(String)}
                          setForm={setForm}
                          placeholder="R"
                          disabled={form.basedOn === "upload"}
                        />
                      </div>

                      {/* F-Score */}
                      <div style={{ flex: "0 0 180px" }}>
                        <MultiSelect
                          name="fScore"
                          label="F-Score"
                          allowed={(options.f_scores || [1, 2, 3, 4, 5]).map(String)}
                          selected={(form.fScore || []).map(String)}
                          setForm={setForm}
                          placeholder="F"
                          disabled={form.basedOn === "upload"}
                        />
                      </div>

                      {/* M-Score */}
                      <div style={{ flex: "0 0 180px" }}>
                        <MultiSelect
                          name="mScore"
                          label="M-Score"
                          allowed={(options.m_scores || [1, 2, 3, 4, 5]).map(String)}
                          selected={(form.mScore || []).map(String)}
                          setForm={setForm}
                          placeholder="M"
                          disabled={form.basedOn === "upload"}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* RFM Segmented */}
            {isSegmented && options && (
              <div style={{ marginTop: 10 }}>
                <div style={{ flex: "0 0 180px", maxWidth: "180px" }}>
                  <MultiSelectDropdown
                    name="rfmSegment"
                    label="RFM Segments"
                    placeholder="Select RFM segments"
                    optionsProvider={() => options.rfm_segments}
                    disabled={watchBasedOn === "upload"}
                  />
                </div>
              </div>
            )}

            {/* Purchase Type - matching reference exact layout */}
            <div className="form-field" style={{ marginTop: 16 }}>
              <label>Purchase Type</label>
              <div className="switch-group">
                <label>
                  <span>Any Purchase</span>
                  <input
                    type="checkbox"
                    checked={form.purchaseType?.anyPurchase || false}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        purchaseType: { ...prev.purchaseType, anyPurchase: e.target.checked },
                      }))
                    }
                    disabled={watchBasedOn === "upload"}
                  />
                </label>
                <label>
                  <span>Recent Purchase</span>
                  <input
                    type="checkbox"
                    checked={form.purchaseType?.recentPurchase || false}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        purchaseType: { ...prev.purchaseType, recentPurchase: e.target.checked },
                      }))
                    }
                    disabled={watchBasedOn === "upload"}
                  />
                </label>
              </div>
            </div>

            {/* Product Filters - matching reference exact horizontal scroll layout */}
            <div
              className="product-filters-row"
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                overflowX: "auto",
                whiteSpace: "nowrap",
                marginTop: 16,
              }}
            >
              {/* Brand */}
              <div style={{ flex: "0 0 180px" }}>
                <MultiSelectDropdown
                  name="purchaseBrand"
                  label="Brand"
                  placeholder="Select brands"
                  optionsProvider={() => brandOptions.allowedBrands}
                  disabled={watchBasedOn === "upload"}
                />
              </div>

              {/* Section */}
              <div style={{ flex: "0 0 180px" }}>
                <MultiSelectDropdown
                  name="section"
                  label="Section"
                  placeholder="Select sections"
                  optionsProvider={() => brandOptions.allowedSections}
                  disabled={watchBasedOn === "upload"}
                />
              </div>

              {/* Product */}
              <div style={{ flex: "0 0 180px" }}>
                <MultiSelectDropdown
                  name="product"
                  label="Product"
                  placeholder="Select products"
                  optionsProvider={() => brandOptions.allowedProducts}
                  disabled={watchBasedOn === "upload"}
                />
              </div>

              {/* Model */}
              <div style={{ flex: "0 0 180px" }}>
                <MultiSelectDropdown
                  name="model"
                  label="Model"
                  placeholder="Select models"
                  optionsProvider={() => brandOptions.allowedModels}
                  disabled={watchBasedOn === "upload"}
                />
              </div>

              {/* Item */}
              <div style={{ flex: "0 0 180px" }}>
                <MultiSelectDropdown
                  name="item"
                  label="Item"
                  placeholder="Select items"
                  optionsProvider={() => brandOptions.allowedItems}
                  disabled={watchBasedOn === "upload"}
                />
              </div>

              {/* Value Threshold */}
              <div style={{ flex: "0 0 180px" }}>
                <div className="form-field">
                  <label>Value Threshold</label>
                  <input
                    type="number"
                    value={form.valueThreshold || ""}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, valueThreshold: e.target.value ? parseFloat(e.target.value) : undefined }))
                    }
                    placeholder="e.g. ≥ 50000"
                    step="0.01"
                    min="0"
                    disabled={watchBasedOn === "upload"}
                    style={{ width: "100%" }}
                  />
                </div>
              </div>
            </div>

            {/* Occasions - matching reference exact layout */}
            <div className="campaign-form-row" style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <div style={{ flex: "0 0 180px" }}>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Birthday Range</label>
                  <div className="date-range-picker">
                    <input
                      type="date"
                      value={form.birthdayRange?.[0] || ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          birthdayRange: [e.target.value, prev.birthdayRange?.[1] || ""],
                        }))
                      }
                      disabled={watchBasedOn === "upload"}
                    />
                    <span>to</span>
                    <input
                      type="date"
                      value={form.birthdayRange?.[1] || ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          birthdayRange: [prev.birthdayRange?.[0] || "", e.target.value],
                        }))
                      }
                      disabled={watchBasedOn === "upload"}
                      min={form.birthdayRange?.[0]}
                    />
                  </div>
                </div>
              </div>
              <div style={{ flex: "0 0 180px" }}>
                <div className="form-field" style={{ marginBottom: 0 }}>
                  <label>Anniversary Range</label>
                  <div className="date-range-picker">
                    <input
                      type="date"
                      value={form.anniversaryRange?.[0] || ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          anniversaryRange: [e.target.value, prev.anniversaryRange?.[1] || ""],
                        }))
                      }
                      disabled={watchBasedOn === "upload"}
                    />
                    <span>to</span>
                    <input
                      type="date"
                      value={form.anniversaryRange?.[1] || ""}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          anniversaryRange: [prev.anniversaryRange?.[0] || "", e.target.value],
                        }))
                      }
                      disabled={watchBasedOn === "upload"}
                      min={form.anniversaryRange?.[0]}
                    />
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Upload Mode */}
        {watchBasedOn === "upload" && (
          <div className="upload-card" style={{ marginTop: 5, padding: 16, borderRadius: 8 }}>
            <h3>Upload Contacts</h3>
            <div className="upload-section">
              <div>
                <a href="/api/campaign/upload/template" target="_blank" rel="noopener noreferrer">
                  Download Template
                </a>
                {isEditing && (
                  <>
                    <span style={{ margin: "0 8px", color: "var(--admin-muted-text)" }}>|</span>
                    <span style={{ marginRight: 8, color: "var(--admin-muted-text)", fontWeight: "bold" }}>
                      Do you want to download the uploaded file?
                    </span>
                    <a
                      href={`/api/campaign/${id}/upload/download`}
                      download={`${watchName}.xlsx`}
                      style={{ color: "var(--admin-link)", fontWeight: 500 }}
                    >
                      {watchName}.xlsx
                    </a>
                  </>
                )}
              </div>
              <div style={{ marginTop: 12 }}>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setUploadFile(file);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Submit Button - matching reference exact layout */}
        <div className="form-actions" style={{ textAlign: "center", marginTop: 5 }}>
          <button
            type="button"
            className="btn-primary"
            onClick={isEditing ? handleSubmit : handleCheckAndCreate}
            disabled={loading || !form.name || !form.campaignPeriod}
            style={{ padding: "8px 24px", fontSize: "16px" }}
          >
            {loading ? "Processing..." : isEditing ? "Update Campaign" : "Check and Create Campaign"}
          </button>
        </div>
      </form>
    </div>
  );
}
