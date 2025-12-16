import { useEffect, useState } from "react";
import { getCampaigns, getCampaign, type Campaign } from "../../api/campaign";
import {
  getAllTemplates,
  getTemplateDetails,
  sendWhatsAppText,
  sendWhatsAppImage,
  sendWhatsAppVideo,
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
        const templateName = selectedTemplate.toLowerCase();

        console.log("Template details:", { templateType, mediaType, templateName, templateData });

        let endpoint = sendWhatsAppText;
        // Check if it's a media template - check both template_type and media_type
        // Also check template name as fallback
        const isImageTemplate = 
          mediaType === "image" || 
          templateType === "image" ||
          templateName.includes("image");
        
        const isVideoTemplate = 
          mediaType === "video" || 
          templateType === "video" ||
          templateName.includes("video");

        if (isImageTemplate) {
          endpoint = sendWhatsAppImage;
          console.log("✅ Using sendWhatsAppImage endpoint");
        } else if (isVideoTemplate) {
          endpoint = sendWhatsAppVideo;
          console.log("✅ Using sendWhatsAppVideo endpoint");
        } else {
          console.log("Using sendWhatsAppText endpoint (default)");
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

        // For upload campaigns, phone numbers are already in the database from campaign creation
        // No need to pass phone_numbers here

        const res = await endpoint(payload);
        console.log("Broadcast API Response:", res.data);
        if (res.data.success) {
          console.log("✅ Broadcast successful!", {
            template: selectedTemplate,
            campaign: campaignDetails?.name,
            recipients: res.data.recipients_count || "unknown",
            channels: channels.join(", "),
          });
          setSuccessMsg("Broadcast is successful!");
        } else {
          console.error("❌ Broadcast failed:", res.data);
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

          {campaignDetails && showNext && (
            <div className="campaign-details-grid">
              {/* Customers Shortlisted */}
              {hasValue(campaignDetails?.shortlisted_count) && (
                <div className="detail-card">
                  <h3>Customers Shortlisted</h3>
                  <div className="detail-value">
                    {Number(campaignDetails.shortlisted_count).toLocaleString("en-IN")}
                  </div>
                </div>
              )}

              {/* Campaign Info */}
              {(hasValue(campaignDetails?.name) ||
                (hasValue(campaignDetails?.start_date) && hasValue(campaignDetails?.end_date)) ||
                hasValue(campaignDetails?.based_on)) && (
                <div className="detail-card campaign-info-card">
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

              {/* Location Info */}
              {(hasValue(campaignDetails?.branch) || hasValue(campaignDetails?.city) || hasValue(campaignDetails?.state)) && (
                <div className="detail-card">
                  <h3>Location Info</h3>
                  {hasValue(campaignDetails?.branch) && (
                    <p>
                      <strong>Branch:</strong> {Array.isArray(campaignDetails.branch) 
                        ? campaignDetails.branch.join(", ") 
                        : typeof campaignDetails.branch === 'object' 
                          ? Object.values(campaignDetails.branch).join(", ")
                          : campaignDetails.branch}
                    </p>
                  )}
                  {hasValue(campaignDetails?.city) && (
                    <p>
                      <strong>City:</strong> {Array.isArray(campaignDetails.city) 
                        ? campaignDetails.city.join(", ") 
                        : typeof campaignDetails.city === 'object' 
                          ? Object.values(campaignDetails.city).join(", ")
                          : campaignDetails.city}
                    </p>
                  )}
                  {hasValue(campaignDetails?.state) && (
                    <p>
                      <strong>State:</strong> {Array.isArray(campaignDetails.state) 
                        ? campaignDetails.state.join(", ") 
                        : typeof campaignDetails.state === 'object' 
                          ? Object.values(campaignDetails.state).join(", ")
                          : campaignDetails.state}
                    </p>
                  )}
                </div>
              )}

              {/* Targeting Criteria */}
              {(hasValue(campaignDetails?.recency_min) || hasValue(campaignDetails?.frequency_min) || hasValue(campaignDetails?.monetary_min)) && (
                <div className="detail-card">
                  <h3>Targeting Criteria</h3>
                  {hasValue(campaignDetails?.recency_min) && (
                    <p>
                      <strong>Recency:</strong> {campaignDetails.recency_op || ""} {campaignDetails.recency_min}
                      {campaignDetails.recency_max && ` - ${campaignDetails.recency_max}`}
                    </p>
                  )}
                  {hasValue(campaignDetails?.frequency_min) && (
                    <p>
                      <strong>Frequency:</strong> {campaignDetails.frequency_op || ""} {campaignDetails.frequency_min}
                      {campaignDetails.frequency_max && ` - ${campaignDetails.frequency_max}`}
                    </p>
                  )}
                  {hasValue(campaignDetails?.monetary_min) && (
                    <p>
                      <strong>Monetary:</strong> {campaignDetails.monetary_op || ""} {campaignDetails.monetary_min}
                      {campaignDetails.monetary_max && ` - ${campaignDetails.monetary_max}`}
                    </p>
                  )}
                </div>
              )}

              {/* RFM Scores */}
              {(hasValue(campaignDetails?.r_score) || hasValue(campaignDetails?.f_score) || hasValue(campaignDetails?.m_score)) && (
                <div className="detail-card">
                  <h3>RFM Scores</h3>
                  {hasValue(campaignDetails?.r_score) && (
                    <p>
                      <strong>R-Score:</strong> {Array.isArray(campaignDetails.r_score) 
                        ? campaignDetails.r_score.join(", ") 
                        : typeof campaignDetails.r_score === 'object' 
                          ? Object.values(campaignDetails.r_score).join(", ")
                          : campaignDetails.r_score}
                    </p>
                  )}
                  {hasValue(campaignDetails?.f_score) && (
                    <p>
                      <strong>F-Score:</strong> {Array.isArray(campaignDetails.f_score) 
                        ? campaignDetails.f_score.join(", ") 
                        : typeof campaignDetails.f_score === 'object' 
                          ? Object.values(campaignDetails.f_score).join(", ")
                          : campaignDetails.f_score}
                    </p>
                  )}
                  {hasValue(campaignDetails?.m_score) && (
                    <p>
                      <strong>M-Score:</strong> {Array.isArray(campaignDetails.m_score) 
                        ? campaignDetails.m_score.join(", ") 
                        : typeof campaignDetails.m_score === 'object' 
                          ? Object.values(campaignDetails.m_score).join(", ")
                          : campaignDetails.m_score}
                    </p>
                  )}
                </div>
              )}

              {/* Purchase & Category */}
              {(hasValue(campaignDetails?.purchase_type) || hasValue(campaignDetails?.purchase_brand) || hasValue(campaignDetails?.section)) && (
                <div className="detail-card">
                  <h3>Purchase & Category</h3>
                  {hasValue(campaignDetails?.purchase_type) && (
                    <p>
                      <strong>Purchase Type:</strong> {campaignDetails.purchase_type}
                    </p>
                  )}
                  {hasValue(campaignDetails?.purchase_brand) && (
                    <p>
                      <strong>Brand:</strong> {Array.isArray(campaignDetails.purchase_brand) 
                        ? campaignDetails.purchase_brand.join(", ") 
                        : typeof campaignDetails.purchase_brand === 'object' 
                          ? Object.values(campaignDetails.purchase_brand).join(", ")
                          : campaignDetails.purchase_brand}
                    </p>
                  )}
                  {hasValue(campaignDetails?.section) && (
                    <p>
                      <strong>Section:</strong> {Array.isArray(campaignDetails.section) 
                        ? campaignDetails.section.join(", ") 
                        : typeof campaignDetails.section === 'object' 
                          ? Object.values(campaignDetails.section).join(", ")
                          : campaignDetails.section}
                    </p>
                  )}
                </div>
              )}

              {/* Product & Model */}
              {(hasValue(campaignDetails?.product) || hasValue(campaignDetails?.model) || hasValue(campaignDetails?.item)) && (
                <div className="detail-card">
                  <h3>Product & Model</h3>
                  {hasValue(campaignDetails?.product) && (
                    <p>
                      <strong>Product:</strong> {Array.isArray(campaignDetails.product) 
                        ? campaignDetails.product.join(", ") 
                        : typeof campaignDetails.product === 'object' 
                          ? Object.values(campaignDetails.product).join(", ")
                          : campaignDetails.product}
                    </p>
                  )}
                  {hasValue(campaignDetails?.model) && (
                    <p>
                      <strong>Model:</strong> {Array.isArray(campaignDetails.model) 
                        ? campaignDetails.model.join(", ") 
                        : typeof campaignDetails.model === 'object' 
                          ? Object.values(campaignDetails.model).join(", ")
                          : campaignDetails.model}
                    </p>
                  )}
                  {hasValue(campaignDetails?.item) && (
                    <p>
                      <strong>Item:</strong> {Array.isArray(campaignDetails.item) 
                        ? campaignDetails.item.join(", ") 
                        : typeof campaignDetails.item === 'object' 
                          ? Object.values(campaignDetails.item).join(", ")
                          : campaignDetails.item}
                    </p>
                  )}
                </div>
              )}

              {/* Value & Birthday */}
              {(hasValue(campaignDetails?.value_threshold) || hasValue(campaignDetails?.birthday_start) || hasValue(campaignDetails?.birthday_end)) && (
                <div className="detail-card">
                  <h3>Value & Birthday</h3>
                  {hasValue(campaignDetails?.value_threshold) && (
                    <p>
                      <strong>Value Threshold:</strong> {campaignDetails.value_threshold}
                    </p>
                  )}
                  {(hasValue(campaignDetails?.birthday_start) || hasValue(campaignDetails?.birthday_end)) && (
                    <p>
                      <strong>Birthday Range:</strong> {campaignDetails.birthday_start || ""} → {campaignDetails.birthday_end || ""}
                    </p>
                  )}
                </div>
              )}

              {/* Template and Broadcasting */}
              <div className="detail-card template-broadcast-card">
                <h3>Template Name</h3>
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
                    className="btn-primary gradient-btn"
                    onClick={startBroadcast}
                    disabled={loading}
                  >
                    {loading ? "Broadcasting..." : "Start Broadcasting"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
