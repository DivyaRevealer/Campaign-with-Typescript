import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { useNavigate, useParams } from "react-router-dom";
import {
  checkClientName,
  createClient,
  getClient,
  setClientStatus,
  updateClient,
  type Client,
  type ClientCreate,
  type ClientUpdatePayload,
  type ClientNameCheckResponse,
} from "../../api/clients";
import { extractApiErrorMessage } from "../../api/errors";
import { focusNextFieldOnEnter } from "../common/formUtils";
import "../common/adminTheme.css";

type ClientFormProps = {
  code?: string;
  onClose?: () => void;
  onSaved?: () => void;
};

type ClientBase = Omit<Client, "created_by" | "created_at" | "updated_by" | "updated_at">;
type ClientMetadata = Partial<Pick<Client, "created_by" | "created_at" | "updated_by" | "updated_at">>;
type ClientFormState = ClientBase & ClientMetadata;

const SaveIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M5 4h11l3 3v13H5z" />
    <path d="M9 4v4h6V4" />
    <rect x="9" y="13" width="6" height="5" rx="1" />
  </svg>
);

const ClearIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M3 6h18" />
    <path d="M8 6v14a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
    <path d="M9 6l1-3h4l1 3" />
  </svg>
);

const CancelIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="9" />
    <line x1="9" y1="9" x2="15" y2="15" />
    <line x1="15" y1="9" x2="9" y2="15" />
  </svg>
);

const PowerIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <line x1="12" y1="3" x2="12" y2="12" />
    <path d="M7.5 5.5a8 8 0 1 0 9 0" />
  </svg>
);

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const createEmptyClientForm = (): ClientFormState => ({
  client_code: "",
  client_name: "",
  client_add1: "",
  client_add2: "",
  client_add3: "",
  client_city: "",
  client_state: "",
  client_country: "",
  client_zip: "",
  client_contact_person: "",
  client_email: "",
  client_contact_no: "",
  active_flag: "Y",
});

const toOptional = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const buildCreatePayload = (state: ClientFormState): ClientCreate => ({
  client_code: state.client_code.trim(),
  client_name: state.client_name.trim(),
  client_add1: toOptional(state.client_add1),
  client_add2: toOptional(state.client_add2),
  client_add3: toOptional(state.client_add3),
  client_city: toOptional(state.client_city),
  client_state: toOptional(state.client_state),
  client_country: toOptional(state.client_country),
  client_zip: toOptional(state.client_zip),
  client_contact_person: toOptional(state.client_contact_person),
  client_email: toOptional(state.client_email),
  client_contact_no: toOptional(state.client_contact_no),
  active_flag: state.active_flag,
});

const buildUpdatePayload = (state: ClientFormState): ClientUpdatePayload => ({
  client_name: state.client_name.trim(),
  client_add1: toOptional(state.client_add1),
  client_add2: toOptional(state.client_add2),
  client_add3: toOptional(state.client_add3),
  client_city: toOptional(state.client_city),
  client_state: toOptional(state.client_state),
  client_country: toOptional(state.client_country),
  client_zip: toOptional(state.client_zip),
  client_contact_person: toOptional(state.client_contact_person),
  client_email: toOptional(state.client_email),
  client_contact_no: toOptional(state.client_contact_no),
  active_flag: state.active_flag,
  expected_updated_at: state.updated_at ?? null,
});

export default function ClientForm({ code: codeProp, onClose, onSaved }: ClientFormProps = {}) {
  const params = useParams<{ code?: string }>();
  const code = codeProp ?? params.code ?? "";
  const mode: "create" | "edit" = code ? "edit" : "create";
  const nav = useNavigate();

  const [form, setForm] = useState<ClientFormState>(() => createEmptyClientForm());
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [nameError, setNameError] = useState<string>("");
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let active = true;
    setErrorMsg("");
    setNameError("");
    if (mode === "edit" && code) {
      getClient(code)
        .then((data) => {
          if (!active) return;
          setForm({
            ...createEmptyClientForm(),
            ...data,
          });
        })
        .catch(() => {
          if (active) {
            setErrorMsg("Unable to load client details");
          }
        });
    } else {
      setForm(createEmptyClientForm());
    }
    return () => {
      active = false;
    };
  }, [mode, code]);

  useEffect(() => {
    if (mode === "edit") {
      nameInputRef.current?.focus();
    } else {
      codeInputRef.current?.focus();
    }
  }, [mode]);

  const handleChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = event.target;
    const field = name as keyof ClientFormState;
    setForm((prev) => ({ ...prev, [field]: value }));
    if (field === "client_name") {
      setNameError("");
    }
  };

  const handleNameBlur = async () => {
    const name = form.client_name.trim();
    if (!name) {
      setNameError("");
      return;
    }
    try {
      const result: ClientNameCheckResponse = await checkClientName(
        name,
        mode === "edit" ? form.client_code : undefined,
      );
      if (result.exists) {
        setNameError(`Client name already exists (code: ${result.client_code}).`);
      } else {
        setNameError("");
      }
    } catch {
      setNameError("");
    }
  };

  const close = () => {
    if (onClose) {
      onClose();
    } else {
      nav("/clients");
    }
  };

  const reloadLatestClient = async (message: string) => {
    if (!form.client_code) {
      return;
    }
    try {
      const latest = await getClient(form.client_code);
      setForm({
        ...createEmptyClientForm(),
        ...latest,
      });
      setErrorMsg(message);
    } catch (reloadError) {
      setErrorMsg(
        extractApiErrorMessage(
          reloadError,
          "Record changed by someone else; failed to reload the latest.",
        ),
      );
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMsg("");
    if (nameError) return;

    try {
      if (mode === "create") {
        await createClient(buildCreatePayload(form));
        setForm(createEmptyClientForm());
      } else {
        await updateClient(form.client_code, buildUpdatePayload(form));
      }

      if (onSaved) {
        onSaved();
      } else {
        close();
      }
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409 && mode === "edit") {
        await reloadLatestClient("Record changed by someone else; reloaded the latest.");
        return;
      }
      setErrorMsg(extractApiErrorMessage(error, "Save failed"));
    }
  };

  const clearForm = () => {
    setForm(createEmptyClientForm());
    setErrorMsg("");
    setNameError("");
  };

  const toggle = async () => {
    if (!form.client_code) {
      return;
    }
    const next = form.active_flag === "Y" ? "N" : "Y";
    try {
      await setClientStatus(form.client_code, {
        active: next,
        expected_updated_at: form.updated_at ?? null,
      });
      const latest = await getClient(form.client_code);
      setForm({
        ...createEmptyClientForm(),
        ...latest,
      });
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        await reloadLatestClient("Record changed by someone else; reloaded the latest.");
        return;
      }
      setErrorMsg(extractApiErrorMessage(error, "Unable to update status"));
    }
  };

  const canSave =
    form.client_code.trim().length > 0 &&
    form.client_name.trim().length > 0 &&
    !nameError;

  const formBody = (
    <form onSubmit={submit} onKeyDown={focusNextFieldOnEnter}>
      {errorMsg && <div className="message-banner">{errorMsg}</div>}

      <div className="form-grid form-grid--header">
        <div className="form-field form-field--code">
          <label>Code</label>
          <input
            name="client_code"
            value={form.client_code}
            onChange={handleChange}
            required
            disabled={mode === "edit"}
            ref={codeInputRef}
          />
        </div>
        <div>
          <label>Name</label>
          <input
            name="client_name"
            value={form.client_name}
            onChange={handleChange}
            onBlur={handleNameBlur}
            required
            aria-invalid={!!nameError}
            aria-describedby="client-name-help"
            ref={nameInputRef}
          />
          {nameError && (
            <div id="client-name-help" className="inline-message">
              {nameError}
            </div>
          )}
        </div>
      </div>

      <fieldset className="form-section">
        <legend>Address</legend>
        <div className="form-grid">
          <input name="client_add1" placeholder="Address" value={form.client_add1 ?? ""} onChange={handleChange} />
          <input name="client_add2" placeholder="Address" value={form.client_add2 ?? ""} onChange={handleChange} />
          <input name="client_add3" placeholder="Address" value={form.client_add3 ?? ""} onChange={handleChange} />
        </div>
        <div className="form-grid two" style={{ marginTop: 12 }}>
          <input name="client_city" placeholder="City" value={form.client_city ?? ""} onChange={handleChange} />
          <input name="client_state" placeholder="State" value={form.client_state ?? ""} onChange={handleChange} />
          <input name="client_country" placeholder="Country" value={form.client_country ?? ""} onChange={handleChange} />
          <input name="client_zip" placeholder="Zip" value={form.client_zip ?? ""} onChange={handleChange} />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Contact</legend>
        <div className="form-grid">
          <input
            name="client_contact_person"
            placeholder="Contact person"
            value={form.client_contact_person ?? ""}
            onChange={handleChange}
          />
        </div>
        <div className="form-grid two" style={{ marginTop: 12 }}>
          <input
            name="client_contact_no"
            placeholder="Phone"
            value={form.client_contact_no ?? ""}
            onChange={handleChange}
          />
          <input
            name="client_email"
            placeholder="Email"
            value={form.client_email ?? ""}
            onChange={handleChange}
          />
        </div>
      </fieldset>

      <div className="form-actions">
        <button className="btn-primary" type="submit" disabled={!canSave}>
          <SaveIcon /> Save
        </button>
        {mode === "create" && (
          <button className="btn-secondary" type="button" onClick={clearForm}>
            <ClearIcon /> Clear
          </button>
        )}
        <button className="btn-ghost" type="button" onClick={close}>
          <CancelIcon /> Cancel
        </button>
        {mode === "edit" && (
          <button className="btn-danger" type="button" onClick={toggle}>
            <PowerIcon /> {form.active_flag === "Y" ? "Deactivate" : "Activate"}
          </button>
        )}
      </div>
    </form>
  );

  const title = mode === "edit" ? "Edit client" : "Add client";

  if (mode === "create") {
    return (
      <>
        <div className="drawer-backdrop" onClick={close} />
        <div className="drawer-panel">
          <header>
            <h2>{title}</h2>
            <div className="drawer-header-actions">
              <button className="icon-button" type="button" onClick={close} aria-label="Close form">
                <CloseIcon />
              </button>
            </div>
          </header>
          <div className="drawer-content">{formBody}</div>
        </div>
      </>
    );
  }

  return (
    <div className="form-standalone">
      <div className="drawer-panel">
        <header>
          <h2>{title}</h2>
          <div className="drawer-header-actions">
            <button className="icon-button" type="button" onClick={close} aria-label="Close form">
              <CloseIcon />
            </button>
          </div>
        </header>
        <div className="drawer-content">{formBody}</div>
      </div>
    </div>
  );
}