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
              {/* Left Card: Campaign Info */}
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

              {/* Right Card: Template and Broadcasting */}
              <div className="detail-card template-broadcast-card">
                <h3>Template and Broadcasting Mode</h3>
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
