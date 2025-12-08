import { useEffect, useState } from "react";
import {
  getAllTemplates,
  createTextTemplate,
  createImageTemplate,
  createVideoTemplate,
  syncTemplate,
  type Template,
} from "../../api/template";
import { extractApiErrorMessage } from "../../api/errors";
import "../common/adminTheme.css";
import "./TemplateCreation.css";

export default function TemplateCreation() {
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [searchText, setSearchText] = useState("");
  const [templateType, setTemplateType] = useState("text");
  const [mediaType, setMediaType] = useState("image");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Form state
  const [formData, setFormData] = useState({
    name: "",
    language: "en",
    category: "MARKETING",
    header: "",
    body: "",
    footer: "",
  });

  const filteredTemplates = templates.filter((t) =>
    [t.name, t.templateType, t.templateCreateStatus]
      .join(" ")
      .toLowerCase()
      .includes(searchText.toLowerCase())
  );

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      setLoading(true);
      const list = await getAllTemplates();
      console.log("Templates loaded:", list);
      console.log("Template count:", list.length);
      // Sort by ID if available, otherwise by name
      list.sort((a, b) => {
        if (a.id && b.id) {
          return (b.id || 0) - (a.id || 0);
        }
        return (b.name || "").localeCompare(a.name || "");
      });
      setTemplates(list);
    } catch (err) {
      console.error("Error loading templates:", err);
      setErrorMsg(extractApiErrorMessage(err, "Failed to fetch templates"));
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      setMediaFile(null);
      return;
    }
    const limit = mediaType === "image" ? 4 * 1024 * 1024 : 9 * 1024 * 1024;
    if (file.size > limit) {
      setErrorMsg(`File must be smaller than ${mediaType === "image" ? "4" : "9"}MB`);
      e.target.value = "";
      setMediaFile(null);
      return;
    }
    setMediaFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    try {
      if (templateType === "text") {
        const bodyHasVars = /\{\{\d+\}\}/.test(formData.body);

        const bodyComponent = bodyHasVars
          ? {
              type: "BODY",
              text: formData.body,
              example: { body_text: [[formData.body || "sample text"]] },
            }
          : {
              type: "BODY",
              text: formData.body,
            };

        const payload = {
          name: formData.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
          language: formData.language,
          category: formData.category,
          components: [
            { type: "HEADER", format: "TEXT", text: formData.header || "" },
            bodyComponent,
            { type: "FOOTER", text: formData.footer || "" },
          ],
        };

        const res = await createTextTemplate(payload);
        if (res.data.success === true) {
          await handleSyncTemplate(formData.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
        }
        setOpen(false);
        resetForm();
      } else {
        if (!mediaFile) {
          setErrorMsg("Please upload media file");
          return;
        }
        const formDataObj = new FormData();
        formDataObj.append("name", formData.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
        formDataObj.append("language", formData.language);
        formDataObj.append("category", formData.category);
        formDataObj.append("body", formData.body);
        formDataObj.append("footer", formData.footer || "");
        formDataObj.append("file", mediaFile);

        const endpoint = mediaType === "image" ? createImageTemplate : createVideoTemplate;
        const res = await endpoint(formDataObj);
        if (res.data.success === true) {
          await handleSyncTemplate(formData.name.toLowerCase().replace(/[^a-z0-9_]/g, "_"));
        }
        setOpen(false);
        resetForm();
      }
      await loadTemplates();
      setSuccessMsg("Template created successfully");
    } catch (err) {
      setErrorMsg(extractApiErrorMessage(err, "Failed to create template"));
    }
  };

  const handleSyncTemplate = async (templateName: string) => {
    try {
      const res = await syncTemplate({ name: templateName });
      if (res.data.sync_status.success) {
        setSuccessMsg("Template synced successfully");
        await loadTemplates();
      }
    } catch (err) {
      setErrorMsg(extractApiErrorMessage(err, "Failed to sync template"));
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      language: "en",
      category: "MARKETING",
      header: "",
      body: "",
      footer: "",
    });
    setTemplateType("text");
    setMediaType("image");
    setMediaFile(null);
  };

  const statusColors: Record<string, string> = {
    APPROVED: "#22c55e",
    PENDING: "#f59e0b",
    REJECTED: "#ef4444",
  };

  return (
    <div className="template-creation-page">
      <div className="template-header">
        <h1>Template Management</h1>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          + Create Template
        </button>
      </div>

      {errorMsg && (
        <div className="message-banner error">
          <span style={{ flex: 1 }}>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg("")}
            className="close-btn"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}

      {successMsg && (
        <div className="message-banner success">
          <span style={{ flex: 1 }}>{successMsg}</span>
          <button
            type="button"
            onClick={() => setSuccessMsg("")}
            className="close-btn"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}

      <div className="template-filters">
        <input
          type="text"
          className="search-input"
          placeholder="Search templates..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading">Loading templates...</div>
      ) : filteredTemplates.length === 0 ? (
        <div className="loading">No templates found. Create your first template using the button above.</div>
      ) : (
        <div className="template-grid">
          {filteredTemplates.map((t) => (
            <div key={t.id || t.name} className="template-card">
              <div className="template-card-header">
                <h3>{t.name}</h3>
              </div>
              <div className="template-card-body">
                <div className="template-tags">
                  <span className="tag">{t.templateType || "N/A"}</span>
                  <span
                    className="tag status"
                    style={{
                      backgroundColor: statusColors[t.templateCreateStatus || ""] || "#6b7280",
                    }}
                  >
                    {t.templateCreateStatus || "N/A"}
                  </span>
                </div>
              </div>
              <div className="template-card-actions">
                <button
                  className="btn-icon"
                  onClick={() => handleSyncTemplate(t.name)}
                  title="Sync Template"
                >
                  🔄
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <>
          <div className="modal-backdrop" onClick={() => setOpen(false)} />
          <div className="modal-panel">
            <header>
              <h2>Create Template</h2>
              <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close">
                ×
              </button>
            </header>
            <form onSubmit={handleSubmit} className="template-form">
              <div className="form-field">
                <label htmlFor="name">Name *</label>
                <input
                  id="name"
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="language">Language *</label>
                <select
                  id="language"
                  required
                  value={formData.language}
                  onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                >
                  <option value="en">English</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="category">Category *</label>
                <select
                  id="category"
                  required
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                >
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utility</option>
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="templateType">Template Type *</label>
                <select
                  id="templateType"
                  required
                  value={templateType}
                  onChange={(e) => setTemplateType(e.target.value)}
                >
                  <option value="text">Text</option>
                  <option value="media">Media</option>
                </select>
              </div>

              {templateType === "media" && (
                <>
                  <div className="form-field">
                    <label>Media Type *</label>
                    <div className="radio-group">
                      <label>
                        <input
                          type="radio"
                          value="image"
                          checked={mediaType === "image"}
                          onChange={(e) => setMediaType(e.target.value)}
                        />
                        Image
                      </label>
                      <label>
                        <input
                          type="radio"
                          value="video"
                          checked={mediaType === "video"}
                          onChange={(e) => setMediaType(e.target.value)}
                        />
                        Video
                      </label>
                    </div>
                  </div>

                  <div className="form-field">
                    <label htmlFor="file">Upload File *</label>
                    <input
                      id="file"
                      type="file"
                      accept={mediaType === "image" ? "image/*" : "video/*"}
                      onChange={handleFileChange}
                      required
                    />
                    <small>
                      Upload {mediaType} less than {mediaType === "image" ? "4" : "9"}MB
                    </small>
                  </div>
                </>
              )}

              <div className="form-field">
                <label htmlFor="header">Header Text</label>
                <input
                  id="header"
                  type="text"
                  value={formData.header}
                  onChange={(e) => setFormData({ ...formData, header: e.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="body">Body Text *</label>
                <textarea
                  id="body"
                  required
                  rows={4}
                  value={formData.body}
                  onChange={(e) => setFormData({ ...formData, body: e.target.value })}
                />
              </div>

              <div className="form-field">
                <label htmlFor="footer">Footer Text</label>
                <input
                  id="footer"
                  type="text"
                  value={formData.footer}
                  onChange={(e) => setFormData({ ...formData, footer: e.target.value })}
                />
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-primary">
                  Submit
                </button>
                <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
