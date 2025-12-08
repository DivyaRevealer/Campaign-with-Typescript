import { useEffect, useState } from "react";
import { getCampaigns, getCampaign, type Campaign } from "../../api/campaign";
import {
  getAllTemplates,
  getTemplateDetails,
  sendWhatsAppText,
  sendWhatsAppImage,
  sendWhatsAppVideo,
  downloadUploadTemplate,
  type Template,
} from "../../api/template";
import { extractApiErrorMessage } from "../../api/errors";
import "../common/adminTheme.css";
import "./RunTemplate.css";

export default function RunTemplate() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [selectedCampaign, setSelectedCampaign] = useState<number | null>(null);
  const [campaignDetails, setCampaignDetails] = useState<any>(null);
  const [showNext, setShowNext] = useState(false);
  const [channels, setChannels] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [phoneNumbers, setPhoneNumbers] = useState<string>("");

  useEffect(() => {
    loadCampaigns();
    loadTemplates();
  }, []);

  const loadCampaigns = async () => {
    try {
      const list = await getCampaigns();
      setCampaigns(list);
    } catch (err) {
      setErrorMsg(extractApiErrorMessage(err, "Failed to load campaigns"));
    }
  };

  const loadTemplates = async () => {
    try {
      const list = await getAllTemplates();
      const approved = list.filter(
        (t) => t.templateCreateStatus === "APPROVED" || t.Status === "APPROVED"
      );
      approved.sort((a, b) => (b.id || 0) - (a.id || 0));
      setTemplates(approved);
    } catch (err) {
      setErrorMsg(extractApiErrorMessage(err, "Failed to fetch templates"));
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadUploadTemplate();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = "campaign_upload_template.xlsx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      setErrorMsg(extractApiErrorMessage(err, "Failed to download template"));
    }
  };

  const handleSelect = async (campaignId: number) => {
    setSelectedCampaign(campaignId);
    try {
      const data = await getCampaign(campaignId);
      setCampaignDetails(data);
      setShowNext(true);
    } catch (err) {
      setErrorMsg(extractApiErrorMessage(err, "Failed to load campaign details"));
    }
  };

  const hasValue = (v: any): boolean => {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "string") return v.trim() !== "";
    return v !== 0;
  };

  const startBroadcast = async () => {
    if (!selectedTemplate) {
      setErrorMsg("Please select a template");
      return;
    }
    if (channels.length === 0) {
      setErrorMsg("Please select at least one channel");
      return;
    }

    setLoading(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      if (channels.includes("WhatsApp")) {
        // First, try to get template details from the API
        // If that fails, use the template data we already have from getAllTemplates
        let templateData;
        try {
          templateData = await getTemplateDetails(selectedTemplate);
        } catch (err) {
          // If getTemplateDetails fails, use data from the template list
          const templateFromList = templates.find(t => t.name === selectedTemplate);
          if (!templateFromList) {
            throw new Error(`Template ${selectedTemplate} not found in available templates`);
          }
          // Infer template type and media type from the template list data
          const templateType = templateFromList.templateType || templateFromList.template_type || "text";
          const category = templateFromList.category || "";
          // If category is MARKETING and templateType is not "text", it's likely media
          const inferredTemplateType = (category.toUpperCase() === "MARKETING" && templateType !== "text") 
            ? "media" 
            : templateType;
          
          templateData = {
            template_name: selectedTemplate,
            template_type: inferredTemplateType,
            media_type: templateFromList.media_type || null,
          };
        }
        const templateType = templateData.template_type;
        const mediaType = templateData.media_type;

        let endpoint = sendWhatsAppText;
        if (templateType === "media") {
          if (mediaType === "image") {
            endpoint = sendWhatsAppImage;
          } else if (mediaType === "video") {
            endpoint = sendWhatsAppVideo;
          }
        }

        if (!selectedTemplate) {
          setErrorMsg("Please select a template");
          setLoading(false);
          return;
        }

        const basedOn = campaignDetails?.based_on || "Customer Base";
        const payload: any = {
          template_name: selectedTemplate,
          basedon_value: basedOn,
          campaign_id: campaignDetails?.id,
        };

        // Only include phone_numbers if based_on is "upload"
        if (basedOn === "upload") {
          if (!phoneNumbers.trim()) {
            setErrorMsg("Please enter phone numbers when using 'upload' mode");
            setLoading(false);
            return;
          }
          payload.phone_numbers = phoneNumbers.trim();
        }

        const res = await endpoint(payload);
        if (res.data.success) {
          setSuccessMsg("Broadcast is successful!");
        } else {
          setErrorMsg("Broadcast Failed!");
        }
      }
    } catch (err) {
      setErrorMsg(extractApiErrorMessage(err, "Failed to send broadcast"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="run-template-page">
      <div className="run-template-container">
        <div className="run-template-header">
          <h1>Run Campaign</h1>
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

        <div className="run-template-card">
          <div className="form-field">
            <label htmlFor="campaign">Choose Campaign *</label>
            <select
              id="campaign"
              value={selectedCampaign || ""}
              onChange={(e) => {
                const val = e.target.value;
                if (val) {
                  handleSelect(Number(val));
                } else {
                  setSelectedCampaign(null);
                  setCampaignDetails(null);
                  setShowNext(false);
                }
              }}
            >
              <option value="">Select a campaign</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {campaignDetails && (
            <div className="campaign-details-grid">
              {hasValue(campaignDetails?.shortlisted_count) && (
                <div className="detail-card">
                  <h3>Customers Shortlisted</h3>
                  <div className="detail-value">
                    {Number(campaignDetails.shortlisted_count).toLocaleString("en-IN")}
                  </div>
                </div>
              )}

              {(hasValue(campaignDetails?.name) ||
                (hasValue(campaignDetails?.start_date) && hasValue(campaignDetails?.end_date)) ||
                hasValue(campaignDetails?.based_on)) && (
                <div className="detail-card">
                  <h3>Campaign Info</h3>
                  {hasValue(campaignDetails?.name) && (
                    <p>
                      <strong>Name:</strong> {campaignDetails.name}
                    </p>
                  )}
                  {hasValue(campaignDetails?.start_date) && hasValue(campaignDetails?.end_date) && (
                    <p>
                      <strong>Period:</strong> {campaignDetails.start_date} →{" "}
                      {campaignDetails.end_date}
                    </p>
                  )}
                  {hasValue(campaignDetails?.based_on) && (
                    <p>
                      <strong>Based On:</strong> {campaignDetails.based_on}
                    </p>
                  )}
                </div>
              )}

              {showNext && (
                <div className="detail-card template-selection">
                  <h3>Template Selection</h3>
                  <div className="form-field">
                    <label htmlFor="template">Template Name *</label>
                    <select
                      id="template"
                      value={selectedTemplate}
                      onChange={(e) => setSelectedTemplate(e.target.value)}
                    >
                      <option value="">Select an approved template</option>
                      {templates.map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {campaignDetails?.based_on === "upload" && (
                    <>
                      <div className="form-field">
                        <label>Download Template</label>
                        <div style={{ marginBottom: "12px" }}>
                          <button
                            type="button"
                            onClick={handleDownloadTemplate}
                            style={{
                              color: "var(--admin-link, #66b0ff)",
                              background: "none",
                              border: "none",
                              textDecoration: "underline",
                              fontWeight: 500,
                              cursor: "pointer",
                              padding: 0,
                              fontFamily: "inherit",
                              fontSize: "inherit",
                            }}
                          >
                            📥 Download Excel Template
                          </button>
                          <small style={{ display: "block", color: "#666", fontSize: "12px", marginTop: "4px" }}>
                            Download the template, fill in phone numbers, and upload it or enter manually below
                          </small>
                        </div>
                      </div>
                      <div className="form-field">
                        <label htmlFor="phoneNumbers">Phone Numbers *</label>
                        <textarea
                          id="phoneNumbers"
                          rows={3}
                          placeholder="Enter comma-separated phone numbers (e.g., 919876543210, 919123456789)"
                          value={phoneNumbers}
                          onChange={(e) => setPhoneNumbers(e.target.value)}
                          style={{
                            width: "100%",
                            padding: "8px",
                            borderRadius: "4px",
                            border: "1px solid #ddd",
                            fontFamily: "inherit",
                          }}
                        />
                        <small style={{ color: "#666", fontSize: "12px" }}>
                          Enter phone numbers with country code (e.g., 91 for India) or use the template above
                        </small>
                      </div>
                    </>
                  )}

                  <div className="form-field">
                    <label>Choose Broadcasting Mode *</label>
                    <div className="checkbox-group">
                      <label>
                        <input
                          type="checkbox"
                          value="WhatsApp"
                          checked={channels.includes("WhatsApp")}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setChannels([...channels, "WhatsApp"]);
                            } else {
                              setChannels(channels.filter((c) => c !== "WhatsApp"));
                            }
                          }}
                        />
                        WhatsApp
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          value="SMS"
                          checked={channels.includes("SMS")}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setChannels([...channels, "SMS"]);
                            } else {
                              setChannels(channels.filter((c) => c !== "SMS"));
                            }
                          }}
                        />
                        SMS
                      </label>
                      <label>
                        <input
                          type="checkbox"
                          value="Email"
                          checked={channels.includes("Email")}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setChannels([...channels, "Email"]);
                            } else {
                              setChannels(channels.filter((c) => c !== "Email"));
                            }
                          }}
                        />
                        Email
                      </label>
                    </div>
                  </div>

                  <div className="form-actions">
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={startBroadcast}
                      disabled={loading}
                    >
                      {loading ? "Broadcasting..." : "Start Broadcasting"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
