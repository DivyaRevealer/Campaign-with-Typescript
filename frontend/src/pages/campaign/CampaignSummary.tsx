import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCampaigns, type Campaign } from "../../api/campaign";
import { extractApiErrorMessage } from "../../api/errors";
import "../common/adminTheme.css";
import "./CampaignSummary.css";

export default function CampaignSummary() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [searchText, setSearchText] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    loadCampaigns();
  }, []);

  const loadCampaigns = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const data = await getCampaigns();
      setCampaigns(data);
    } catch (err) {
      setErrorMsg(extractApiErrorMessage(err, "Failed to load campaigns"));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const filteredCampaigns = campaigns.filter((campaign) =>
    [
      campaign.name,
      campaign.based_on,
      formatDate(campaign.start_date),
      formatDate(campaign.end_date),
    ]
      .join(" ")
      .toLowerCase()
      .includes(searchText.toLowerCase())
  );

  return (
    <div className="campaign-summary-page">
      <div className="campaign-summary-header">
        <h1>Campaign Summary</h1>
        <p>View and manage all your campaigns</p>
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

      <div className="campaign-summary-filters">
        <input
          type="text"
          className="search-input"
          placeholder="Search campaigns..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>

      <div className="campaign-summary-card">
        {loading ? (
          <div className="loading-state">Loading campaigns...</div>
        ) : filteredCampaigns.length === 0 ? (
          <div className="empty-state">
            <p>{searchText ? "No campaigns found matching your search." : "No campaigns found."}</p>
            {!searchText && (
              <Link to="/campaign/new" className="btn-primary">
                Create Your First Campaign
              </Link>
            )}
          </div>
        ) : (
          <div className="admin-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Start Date</th>
                  <th>End Date</th>
                  <th>Based On</th>
                  <th>Created At</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredCampaigns.map((campaign, index) => (
                  <tr
                    key={campaign.id}
                    className={index % 2 === 0 ? "row-even" : "row-odd"}
                  >
                    <td>
                      <strong>{campaign.name}</strong>
                    </td>
                    <td>{formatDate(campaign.start_date)}</td>
                    <td>{formatDate(campaign.end_date)}</td>
                    <td>
                      <span className="badge">{campaign.based_on || "N/A"}</span>
                    </td>
                    <td>{formatDate(campaign.created_at)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-edit"
                        onClick={() => navigate(`/campaign/${campaign.id}`)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

