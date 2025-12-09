"""API endpoints for template management."""

import io
import logging
import re
from typing import Optional

import requests
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_session
from app.core.deps import get_current_user
from app.models.inv_create_campaign import InvCreateCampaign
from app.models.inv_crm_analysis import InvCrmAnalysis
from app.models.inv_template_detail import InvTemplateDetail
from app.models.inv_campaign_upload import InvCampaignUpload
from app.models.inv_user import InvUserMaster
from app.schemas.template import (
    TemplateCreateRequest,
    TemplateDetailOut,
    TemplateSendRequest,
    TemplateSyncRequest,
)

router = APIRouter(prefix="/campaign/templates", tags=["templates"])

logger = logging.getLogger(__name__)


def _upload_image_to_api(api_url: str, api_key: str, contents: bytes, filename: str) -> dict:
    """Upload image to external API."""
    headers = {"Authorization": f"Bearer {api_key}"}
    files = {"file": (filename, io.BytesIO(contents), "image/jpeg")}
    resp = requests.post(api_url, headers=headers, files=files, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _upload_video_to_api(api_url: str, api_key: str, contents: bytes, filename: str) -> dict:
    """Upload video to external API."""
    headers = {"Authorization": f"Bearer {api_key}"}
    files = {"file": (filename, io.BytesIO(contents), "video/mp4")}
    resp = requests.post(api_url, headers=headers, files=files, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _format_phone_numbers(mobile_numbers: list) -> str:
    """Format phone numbers with country code prefix (91 for India)."""
    formatted_numbers = []
    for num in mobile_numbers:
        if num:
            num_str = str(num).strip()
            # Remove any existing country code or + sign
            num_clean = re.sub(r"^\+?91", "", num_str)
            # Remove any non-digit characters
            num_clean = re.sub(r"\D", "", num_clean)
            # Add 91 prefix if number doesn't start with it and is not empty
            if num_clean and not num_clean.startswith("91"):
                formatted_numbers.append(f"91{num_clean}")
            elif num_clean:
                formatted_numbers.append(num_clean)
    return ",".join(formatted_numbers)


async def _save_template_details(
    session: AsyncSession,
    template_name: str,
    file_url: Optional[str] = None,
    file_hvalue: Optional[str] = None,
    template_type: str = "text",
    media_type: Optional[str] = None,
) -> bool:
    """Save or update template details in the database."""
    try:
        result = await session.execute(
            select(InvTemplateDetail).where(InvTemplateDetail.template_name == template_name)
        )
        template = result.scalar_one_or_none()

        if template:
            # Update existing
            template.file_url = file_url
            template.file_hvalue = file_hvalue
            template.template_type = template_type
            template.media_type = media_type
        else:
            # Insert new
            template = InvTemplateDetail(
                template_name=template_name,
                file_url=file_url,
                file_hvalue=file_hvalue,
                template_type=template_type,
                media_type=media_type,
            )
            session.add(template)

        await session.commit()
        return True
    except Exception as e:
        await session.rollback()
        raise HTTPException(status_code=500, detail=f"Error saving template details: {str(e)}")


async def _get_eligible_customers(
    campaign_id: int, basedon: str, session: AsyncSession
) -> dict:
    """Get eligible customers for a campaign."""
    if basedon == "upload":
        return {"campaign_id": campaign_id, "numbers": ""}

    sql = text("""
        SELECT 
            ca.CUST_MOBILENO
        FROM campaigns c
        JOIN crm_analysis ca 
            ON 1=1
        LEFT JOIN crm_sales cs 
            ON cs.CUST_MOBILENO = ca.CUST_MOBILENO
        WHERE 
            c.id = :campaign_id
            AND (
                (
                    c.rfm_segments IS NOT NULL 
                    AND JSON_CONTAINS(c.rfm_segments, JSON_QUOTE(ca.SEGMENT_MAP), '$')
                )
                OR (
                    (c.r_score IS NULL OR JSON_CONTAINS(c.r_score, JSON_ARRAY(ca.R_SCORE), '$'))
                    AND (c.f_score IS NULL OR JSON_CONTAINS(c.f_score, JSON_ARRAY(ca.F_SCORE), '$'))
                    AND (c.m_score IS NULL OR JSON_CONTAINS(c.m_score, JSON_ARRAY(ca.M_SCORE), '$'))
                    AND (c.recency_min IS NULL OR c.recency_max IS NULL OR (ca.DAYS BETWEEN c.recency_min AND c.recency_max))
                    AND (c.frequency_min IS NULL OR c.frequency_max IS NULL OR (ca.F_VALUE BETWEEN c.frequency_min AND c.frequency_max))
                    AND (c.monetary_min IS NULL OR c.monetary_max IS NULL OR (ca.M_VALUE BETWEEN c.monetary_min AND c.monetary_max))
                )
            )
            AND (c.branch IS NULL OR JSON_CONTAINS(c.branch, JSON_QUOTE(ca.LAST_IN_STORE_CODE), '$'))
            AND (c.city IS NULL OR JSON_CONTAINS(c.city, JSON_QUOTE(ca.LAST_IN_STORE_CITY), '$'))
            AND (c.state IS NULL OR JSON_CONTAINS(c.state, JSON_QUOTE(ca.LAST_IN_STORE_STATE), '$'))
            AND (c.section IS NULL OR JSON_CONTAINS(c.section, JSON_QUOTE(cs.SECTION), '$'))
            AND (c.product IS NULL OR JSON_CONTAINS(c.product, JSON_QUOTE(cs.PRODUCT), '$'))
            AND (c.model IS NULL OR JSON_CONTAINS(c.model, JSON_QUOTE(cs.MODELNO), '$'))
            AND (c.item IS NULL OR JSON_CONTAINS(c.item, JSON_QUOTE(cs.ITEM_DESCRIPTION), '$'))
    """)

    result = await session.execute(sql, {"campaign_id": campaign_id})

    if not result:
        return {"campaign_id": campaign_id, "numbers": ""}

    # Format numbers with 91 prefix and comma separator
    numbers = [f"91{row.CUST_MOBILENO}" for row in result if row.CUST_MOBILENO]
    numbers_str = ",".join(numbers)

    return {"campaign_id": campaign_id, "numbers": numbers_str}


@router.post("/create-text-template")
async def create_text_template(
    payload: TemplateCreateRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    """Create a text template."""
    api_key = settings.template_api_key
    channel_number = settings.template_channel_number
    if not api_key or not channel_number:
        raise HTTPException(
            status_code=400, detail="WBOX_TOKEN (or API_KEY) and WBOX_CHANNEL_NUMBER (or CHANNEL_NUMBER) must be configured in environment variables"
        )

    url = f"https://cloudapi.wbbox.in/api/v1.0/create-templates/{channel_number}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(url, json=payload.model_dump(), headers=headers, timeout=30)
        response.raise_for_status()
        result = response.json()

        # Save template details
        await _save_template_details(
            session=session,
            template_name=payload.name,
            template_type="text",
            media_type=None,
        )

        return result
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=response.status_code if "response" in locals() else 500,
            detail=response.text if "response" in locals() else str(e),
        )


@router.post("/create-image-template")
async def create_image_template(
    name: str = Form(...),
    language: str = Form(...),
    category: str = Form(...),
    body: str = Form(...),
    footer: str = Form(""),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    """Create an image template."""
    api_key = settings.template_api_key
    channel_number = settings.template_channel_number
    if not api_key or not channel_number:
        raise HTTPException(
            status_code=400, detail="WBOX_TOKEN (or API_KEY) and WBOX_CHANNEL_NUMBER (or CHANNEL_NUMBER) must be configured in environment variables"
        )

    contents = await file.read()
    if len(contents) > 4 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be less than 4MB")
    upload_url = f"https://cloudapi.wbbox.in/api/v1.0/uploads/{channel_number}"

    try:
        responsefromapi = _upload_image_to_api(upload_url, api_key, contents, file.filename)
        hvalue_url = responsefromapi["data"]["HValue"]
        image_url = responsefromapi["data"]["ImageUrl"]

        if hvalue_url and image_url:
            # Save details to DB
            await _save_template_details(
                session=session,
                template_name=name,
                file_url=image_url,
                file_hvalue=hvalue_url,
                template_type="media",
                media_type="image",
            )

        payload = {
            "name": name,
            "language": language,
            "category": category,
            "components": [
                {"type": "HEADER", "format": "IMAGE", "example": {"header_handle": [hvalue_url]}},
                {"type": "BODY", "text": body},
                {"type": "FOOTER", "text": footer},
            ],
        }

        url = f"https://cloudapi.wbbox.in/api/v1.0/create-templates/{channel_number}"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=response.status_code if "response" in locals() else 500,
            detail=response.text if "response" in locals() else str(e),
        )


@router.post("/create-video-template")
async def create_video_template(
    name: str = Form(...),
    language: str = Form(...),
    category: str = Form(...),
    body: str = Form(...),
    footer: str = Form(""),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    """Create a video template."""
    api_key = settings.template_api_key
    channel_number = settings.template_channel_number
    if not api_key or not channel_number:
        raise HTTPException(
            status_code=400, detail="WBOX_TOKEN (or API_KEY) and WBOX_CHANNEL_NUMBER (or CHANNEL_NUMBER) must be configured in environment variables"
        )

    contents = await file.read()
    if len(contents) > 9 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Video must be less than 9MB")

    upload_url = f"https://cloudapi.wbbox.in/api/v1.0/uploads/{channel_number}"

    try:
        responsefromapi = _upload_video_to_api(upload_url, api_key, contents, file.filename)
        hvalue_url = responsefromapi["data"]["HValue"]
        video_url = responsefromapi["data"]["ImageUrl"]

        if hvalue_url and video_url:
            # Save details to DB
            await _save_template_details(
                session=session,
                template_name=name,
                file_url=video_url,
                file_hvalue=hvalue_url,
                template_type="media",
                media_type="video",
            )

        payload = {
            "name": name,
            "language": language,
            "category": category,
            "components": [
                {"type": "HEADER", "format": "VIDEO", "example": {"header_handle": [hvalue_url]}},
                {"type": "BODY", "text": body},
                {"type": "FOOTER", "text": footer},
            ],
        }

        url = f"https://cloudapi.wbbox.in/api/v1.0/create-templates/{channel_number}"
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        return response.json()
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=response.status_code if "response" in locals() else 500,
            detail=response.text if "response" in locals() else str(e),
        )


@router.post("/sync-template")
async def sync_template(
    payload: TemplateSyncRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    """Sync a template."""
    api_key = settings.template_api_key
    if not api_key:
        raise HTTPException(status_code=400, detail="WBOX_TOKEN (or API_KEY) must be configured in environment variables")

    template_name = payload.name
    if not template_name:
        raise HTTPException(status_code=400, detail="Template name missing")

    sync_url = f"https://cloudapi.wbbox.in/api/v1.0/sync-templates/{template_name}"
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        sync_resp = requests.get(sync_url, headers=headers, timeout=30)
        sync_resp.raise_for_status()

        return {"success": True, "sync_status": sync_resp.json()}
    except requests.HTTPError as e:
        raise HTTPException(
            status_code=sync_resp.status_code if "sync_resp" in locals() else 500,
            detail=sync_resp.text if "sync_resp" in locals() else str(e),
        )


@router.get("/getAlltemplates")
async def list_templates(
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    """List all templates from external API and database."""
    api_key = settings.template_api_key
    
    # Get templates from database
    db_templates_result = await session.execute(select(InvTemplateDetail))
    db_templates = db_templates_result.scalars().all()
    
    # Build a map of database templates by name
    db_template_map = {
        t.template_name: {
            "id": abs(hash(t.template_name)) % (10**10),  # Use positive hash as ID
            "name": t.template_name,
            "template_type": t.template_type,
            "templateType": t.template_type,
            "media_type": t.media_type,
            "Status": "PENDING",  # Default status for DB templates
            "templateCreateStatus": "PENDING",
        }
        for t in db_templates
    }
    
    # Try to get templates from external API
    api_templates = []
    if api_key:
        try:
            url = "https://cloudapi.wbbox.in/api/v1.0/templates"
            headers = {"Authorization": f"Bearer {api_key}"}
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            api_data = response.json()
            
            # Extract templates from API response
            if isinstance(api_data, dict):
                api_templates = api_data.get("templates", api_data.get("data", []))
            elif isinstance(api_data, list):
                api_templates = api_data
            
            # Log first template structure for debugging (remove after fixing)
            if api_templates and len(api_templates) > 0:
                logger.info(f"Sample API template structure: {list(api_templates[0].keys()) if isinstance(api_templates[0], dict) else 'Not a dict'}")
                if isinstance(api_templates[0], dict):
                    logger.info(f"Sample template status fields: status={api_templates[0].get('status')}, Status={api_templates[0].get('Status')}")
        except Exception as e:
            # If API call fails, continue with database templates only
            logger.warning(f"Error fetching templates from external API: {e}")
            pass
    
    # Merge API templates with database templates
    # API templates take precedence (they have status info)
    merged_templates = {}
    
    # Add API templates first
    for template in api_templates:
        if isinstance(template, dict):
            name = template.get("name") or template.get("template_name")
            if name:
                # Start with the original API template to preserve all fields
                normalized_template = dict(template)
                # Ensure name is set correctly
                normalized_template["name"] = name
                
                # Extract status from various possible locations in API response
                status = (
                    template.get("status") or 
                    template.get("Status") or 
                    template.get("template_status") or
                    template.get("approval_status") or
                    # Check nested structures
                    (template.get("meta", {}) if isinstance(template.get("meta"), dict) else {}).get("status") or
                    (template.get("data", {}) if isinstance(template.get("data"), dict) else {}).get("status") or
                    None
                )
                
                # If no status found, try to infer from other fields or default to PENDING
                if not status:
                    # Check if template has components (might indicate it's created but not approved)
                    if template.get("components"):
                        status = "PENDING"  # Created but might not be approved yet
                    else:
                        status = "PENDING"  # Default for templates without clear status
                
                # Normalize status to uppercase for consistency
                status = str(status).upper() if status else "PENDING"
                
                # Add normalized fields for frontend compatibility (without overwriting existing)
                if "templateType" not in normalized_template:
                    normalized_template["templateType"] = template.get("category", template.get("template_type", "text"))
                if "template_type" not in normalized_template:
                    normalized_template["template_type"] = template.get("category", template.get("template_type", "text"))
                if "templateCreateStatus" not in normalized_template:
                    normalized_template["templateCreateStatus"] = status
                if "Status" not in normalized_template:
                    normalized_template["Status"] = status
                # Ensure ID exists
                if "id" not in normalized_template:
                    normalized_template["id"] = abs(hash(name)) % (10**10)
                merged_templates[name] = normalized_template
    
    # Add database templates that aren't in API response
    for name, db_template in db_template_map.items():
        if name not in merged_templates:
            merged_templates[name] = db_template
        else:
            # Update API template with database details if available
            existing = merged_templates[name]
            # Merge database template fields into API template (prefer API values, fallback to DB)
            if not existing.get("template_type") and db_template.get("template_type"):
                existing["template_type"] = db_template["template_type"]
                existing["templateType"] = db_template["templateType"]
            if not existing.get("media_type") and db_template.get("media_type"):
                existing["media_type"] = db_template["media_type"]
            # If API template has UNKNOWN status but DB has PENDING, use PENDING
            if existing.get("Status") == "UNKNOWN" and db_template.get("Status") == "PENDING":
                existing["Status"] = "PENDING"
                existing["templateCreateStatus"] = "PENDING"
    
    # Convert to list
    templates_list = list(merged_templates.values())
    
    # Return in the same format as the external API (which the reference project uses)
    # The external API typically returns {"templates": [...]} or just the array
    # But we need to ensure all templates have the required fields for the frontend
    return {"templates": templates_list, "data": templates_list}


@router.get("/{template_name}/details", response_model=TemplateDetailOut)
async def get_template_details(
    template_name: str,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    """Get template details from database or external API."""
    # First, try to get from local database
    result = await session.execute(
        select(InvTemplateDetail).where(InvTemplateDetail.template_name == template_name)
    )
    template = result.scalar_one_or_none()

    if template:
        return TemplateDetailOut.model_validate(template)

    # If not in database, try to get from external API
    api_key = settings.template_api_key
    if api_key:
        try:
            url = "https://cloudapi.wbbox.in/api/v1.0/templates"
            headers = {"Authorization": f"Bearer {api_key}"}
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            api_data = response.json()
            
            # Extract templates from API response
            if isinstance(api_data, dict):
                api_templates = api_data.get("templates", api_data.get("data", []))
            elif isinstance(api_data, list):
                api_templates = api_data
            else:
                api_templates = []
            
            # Find the template in API response (case-insensitive and handle URL encoding)
            template_name_lower = template_name.lower().strip()
            for api_template in api_templates:
                if isinstance(api_template, dict):
                    name = api_template.get("name") or api_template.get("template_name")
                    if name:
                        # Compare case-insensitively and handle variations
                        name_lower = str(name).lower().strip()
                        if name_lower == template_name_lower or name == template_name:
                            # Create a TemplateDetailOut from API data
                            # Infer template_type from category
                            category = api_template.get("category", "text")
                            template_type = "text" if category.lower() in ["text", "utility"] else "media"
                            
                            # Infer media_type from components
                            media_type = None
                            components = api_template.get("components", [])
                            if components:
                                header = next((c for c in components if c.get("type") == "HEADER"), None)
                                if header:
                                    format_type = header.get("format", "").lower()
                                    if format_type == "image":
                                        media_type = "image"
                                    elif format_type == "video":
                                        media_type = "video"
                            
                            # Use current time as fallback for uploaded_at
                            from datetime import datetime
                            return TemplateDetailOut(
                                template_name=template_name,
                                template_type=template_type,
                                media_type=media_type,
                                file_url=None,  # API doesn't provide file_url in list endpoint
                                file_hvalue=None,
                                uploaded_at=datetime.now(),  # Use current time as fallback
                            )
        except Exception as e:
            logger.warning(f"Error fetching template from external API: {e}")
            # Continue to raise 404 below

    # Template not found in database or API
    raise HTTPException(status_code=404, detail="Template not found")


@router.post("/sendWatsAppText")
async def send_whatsapp_text(
    payload: TemplateSendRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    """Send WhatsApp text template."""
    api_key = settings.template_api_key
    channel_number = settings.template_channel_number
    if not api_key or not channel_number:
        raise HTTPException(
            status_code=400, detail="WBOX_TOKEN (or API_KEY) and WBOX_CHANNEL_NUMBER (or CHANNEL_NUMBER) must be configured in environment variables"
        )

    template_name = payload.template_name
    if not template_name:
        raise HTTPException(status_code=400, detail="template_name is required")
    
    basedon = payload.basedon_value or "upload"
    campaign_id = payload.campaign_id

    if basedon == "upload":
        # For upload campaigns, try to get phone_numbers from payload first (matching reference project)
        numbers_str = payload.phone_numbers or ""
        
        # If not in payload, try to fetch from database (campaign_uploads table) as fallback
        if not numbers_str and campaign_id:
            result = await session.execute(
                select(InvCampaignUpload.mobile_no)
                .where(InvCampaignUpload.campaign_id == campaign_id)
            )
            mobile_numbers = result.scalars().all()
            if mobile_numbers:
                logger.info(f"Found {len(mobile_numbers)} phone numbers in database for campaign {campaign_id}")
                # Format numbers with country code prefix (91 for India)
                numbers_str = _format_phone_numbers(mobile_numbers)
                logger.info(f"Formatted phone numbers: {numbers_str[:100]}...")  # Log first 100 chars
            else:
                logger.warning(f"No phone numbers found in database for campaign {campaign_id}")
        
        if not numbers_str:
            raise HTTPException(
                status_code=400,
                detail="phone_numbers is required when basedon_value is 'upload'"
            )
        else:
            logger.info(f"Using phone numbers for upload campaign: {len(numbers_str.split(','))} numbers")
    else:
        if not campaign_id:
            raise HTTPException(status_code=400, detail="campaign_id is required for Customer Base")
        numbers_obj = await _get_eligible_customers(campaign_id, basedon, session)
        numbers_str = numbers_obj.get("numbers", "")
        if not numbers_str:
            raise HTTPException(
                status_code=400, 
                detail=f"No eligible customers found for campaign {campaign_id}. Please check campaign filters."
            )

    # Check template type from database (matching old project behavior)
    template_detail_result = await session.execute(
        select(InvTemplateDetail).where(InvTemplateDetail.template_name == template_name)
    )
    template_detail = template_detail_result.scalar_one_or_none()
    
    # Determine if this is a media template and what type
    is_media_template = False
    media_type = None
    media_url = None
    
    if template_detail:
        if template_detail.template_type == "media" or template_detail.media_type:
            is_media_template = True
            media_type = template_detail.media_type
            media_url = template_detail.file_url
            logger.info(f"Detected media template: {template_name}, type: {media_type}, url: {media_url}")
    
    url = f"https://cloudapi.wbbox.in/api/v1.0/messages/send-template/{channel_number}"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "apikey": f"{api_key}",
        "Content-Type": "application/json",
    }

    # Clean and join the numbers into a single comma-separated string
    # Preserve country code (already formatted)
    cleaned_numbers = [n.strip() for n in numbers_str.split(",") if n.strip()]
    recipients = ",".join(filter(None, cleaned_numbers))

    if not recipients:
        raise HTTPException(status_code=400, detail="No valid phone numbers provided")
    
    # Log sending attempt
    logger.info(f"📤 Attempting to send WhatsApp messages - Template: {template_name}, Recipients: {len(cleaned_numbers)}, Media: {is_media_template}")
    print(f"📤 Sending WhatsApp broadcast - Template: {template_name}, Recipients: {len(cleaned_numbers)}")

    # Build template payload - add media components if it's a media template (matching old project)
    template_payload = {
        "name": template_name,
        "language": {"code": "en"},
    }
    
    components = []
    if is_media_template and media_url:
        if media_type == "image":
            components.append({
                "type": "header",
                "parameters": [{"type": "image", "image": {"link": media_url}}],
            })
        elif media_type == "video":
            components.append({
                "type": "header",
                "parameters": [{"type": "video", "video": {"link": media_url}}],
            })
    
    if components:
        template_payload["components"] = components

    payload_data = {
        "messaging_product": "whatsapp",
        "to": recipients,
        "type": "template",
        "template": template_payload,
    }

    try:
        resp = requests.post(url, json=payload_data, headers=headers, timeout=30)
        resp.raise_for_status()
        response_data = resp.json()
        
        # Log the response for debugging
        logger.info(f"WhatsApp API response for template {template_name}: {response_data}")
        print(f"📥 WhatsApp API response for template {template_name}: {response_data}")
        
        # Check if the API response indicates success
        is_success = (
            resp.status_code == 200 or resp.status_code == 201 or
            response_data.get("success") is True or
            response_data.get("status") == "success" or
            response_data.get("status") == "sent" or
            (isinstance(response_data, dict) and "messages" in response_data) or
            (isinstance(response_data, dict) and "data" in response_data)
        )
        
        if not is_success:
            error_msg = response_data.get("error") or response_data.get("message") or "Unknown error from WhatsApp API"
            logger.error(f"WhatsApp API returned non-success response: {error_msg}")
            raise HTTPException(
                status_code=400,
                detail=f"WhatsApp API error: {error_msg}"
            )
        
        # Log success details
        logger.info(f"✅ WhatsApp messages sent successfully! Template: {template_name}, Recipients: {len(cleaned_numbers)}")
        print(f"✅ WhatsApp broadcast successful - Template: {template_name}, Recipients: {len(cleaned_numbers)}, Response: {response_data}")
        
        # Return a consistent success response
        return {
            "success": True,
            "data": response_data,
            "message": "Messages sent successfully",
            "template_name": template_name,
            "recipients_count": len(cleaned_numbers)
        }
    except requests.HTTPError as e:
        error_detail = "Unknown error"
        if "resp" in locals():
            try:
                error_response = resp.json()
                error_detail = error_response.get("error") or error_response.get("message") or resp.text
            except:
                error_detail = resp.text
        else:
            error_detail = str(e)
        
        logger.error(f"WhatsApp API HTTP error: {error_detail}")
        raise HTTPException(
            status_code=resp.status_code if "resp" in locals() else 500,
            detail=f"WhatsApp API error: {error_detail}",
        )
    except Exception as e:
        logger.error(f"Unexpected error sending WhatsApp message: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to send WhatsApp message: {str(e)}",
        )


@router.post("/sendWatsAppImage")
async def send_whatsapp_image(
    payload: TemplateSendRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    """Send WhatsApp image template."""
    api_key = settings.template_api_key
    channel_number = settings.template_channel_number
    if not api_key or not channel_number:
        raise HTTPException(
            status_code=400, detail="WBOX_TOKEN (or API_KEY) and WBOX_CHANNEL_NUMBER (or CHANNEL_NUMBER) must be configured in environment variables"
        )

    template_name = payload.template_name
    if not template_name:
        raise HTTPException(status_code=400, detail="template_name is required")
    
    basedon = payload.basedon_value or "upload"
    campaign_id = payload.campaign_id

    if basedon == "upload":
        # For upload campaigns, try to get phone_numbers from payload first (matching reference project)
        numbers_str = payload.phone_numbers or ""
        
        # If not in payload, try to fetch from database (campaign_uploads table) as fallback
        if not numbers_str and campaign_id:
            result = await session.execute(
                select(InvCampaignUpload.mobile_no)
                .where(InvCampaignUpload.campaign_id == campaign_id)
            )
            mobile_numbers = result.scalars().all()
            if mobile_numbers:
                logger.info(f"Found {len(mobile_numbers)} phone numbers in database for campaign {campaign_id}")
                # Format numbers with country code prefix (91 for India)
                numbers_str = _format_phone_numbers(mobile_numbers)
                logger.info(f"Formatted phone numbers: {numbers_str[:100]}...")  # Log first 100 chars
            else:
                logger.warning(f"No phone numbers found in database for campaign {campaign_id}")
        
        if not numbers_str:
            raise HTTPException(
                status_code=400,
                detail="phone_numbers is required when basedon_value is 'upload'"
            )
        else:
            logger.info(f"Using phone numbers for upload campaign: {len(numbers_str.split(','))} numbers")
    else:
        if not campaign_id:
            raise HTTPException(status_code=400, detail="campaign_id is required for Customer Base")
        numbers_obj = await _get_eligible_customers(campaign_id, basedon, session)
        numbers_str = numbers_obj.get("numbers", "")
        if not numbers_str:
            raise HTTPException(
                status_code=400, 
                detail=f"No eligible customers found for campaign {campaign_id}. Please check campaign filters."
            )

    # Get template details
    result = await session.execute(
        select(InvTemplateDetail).where(InvTemplateDetail.template_name == template_name)
    )
    template = result.scalar_one_or_none()

    if not template or not template.file_url:
        raise HTTPException(
            status_code=404, detail=f"No file_url found for template {template_name}"
        )

    image_url = template.file_url

    url = f"https://cloudapi.wbbox.in/api/v1.0/messages/send-template/{channel_number}"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "apikey": f"{api_key}",
        "Content-Type": "application/json",
    }

    # Clean and join the numbers into a single comma-separated string (matching old project)
    # Preserve country code (already formatted)
    cleaned_numbers = [n.strip() for n in numbers_str.split(",") if n.strip()]
    recipients = ",".join(filter(None, cleaned_numbers))

    if not recipients:
        raise HTTPException(status_code=400, detail="No valid phone numbers provided")
    
    # Log sending attempt
    logger.info(f"📤 Attempting to send WhatsApp image messages - Template: {template_name}, Recipients: {len(cleaned_numbers)}")
    print(f"📤 Sending WhatsApp image broadcast - Template: {template_name}, Recipients: {len(cleaned_numbers)}")

    # Send in bulk with comma-separated recipients (matching old project approach)
    payload_data = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": recipients,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": "en"},
            "components": [
                {
                    "type": "header",
                    "parameters": [{"type": "image", "image": {"link": image_url}}],
                }
            ],
        },
    }

    try:
        resp = requests.post(url, json=payload_data, headers=headers, timeout=30)
        resp.raise_for_status()
        response_data = resp.json()
        
        # Log the response for debugging
        logger.info(f"WhatsApp API response for template {template_name}: {response_data}")
        print(f"📥 WhatsApp API response for template {template_name}: {response_data}")
        
        # Check if the API response indicates success
        is_success = (
            resp.status_code == 200 or resp.status_code == 201 or
            response_data.get("success") is True or
            response_data.get("status") == "success" or
            response_data.get("status") == "sent" or
            (isinstance(response_data, dict) and "messages" in response_data) or
            (isinstance(response_data, dict) and "data" in response_data)
        )
        
        if not is_success:
            error_msg = response_data.get("error") or response_data.get("message") or "Unknown error from WhatsApp API"
            logger.error(f"WhatsApp API returned non-success response: {error_msg}")
            raise HTTPException(
                status_code=400,
                detail=f"WhatsApp API error: {error_msg}"
            )
        
        # Log success details
        logger.info(f"✅ WhatsApp image messages sent successfully! Template: {template_name}, Recipients: {len(cleaned_numbers)}")
        print(f"✅ WhatsApp image broadcast successful - Template: {template_name}, Recipients: {len(cleaned_numbers)}, Response: {response_data}")
        
        # Return a consistent success response
        return {
            "success": True,
            "data": response_data,
            "message": "Messages sent successfully",
            "template_name": template_name,
            "recipients_count": len(cleaned_numbers)
        }
    except requests.HTTPError as e:
        error_detail = "Unknown error"
        if "resp" in locals():
            try:
                error_response = resp.json()
                error_detail = error_response.get("error") or error_response.get("message") or resp.text
            except:
                error_detail = resp.text
        else:
            error_detail = str(e)
        
        logger.error(f"WhatsApp API HTTP error: {error_detail}")
        raise HTTPException(
            status_code=resp.status_code if "resp" in locals() else 500,
            detail=f"WhatsApp API error: {error_detail}",
        )
    except Exception as e:
        logger.error(f"Unexpected error sending WhatsApp message: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to send WhatsApp message: {str(e)}",
        )


@router.post("/sendWatsAppVideo")
async def send_whatsapp_video(
    payload: TemplateSendRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    user: InvUserMaster = Depends(get_current_user),
):
    """Send WhatsApp video template."""
    api_key = settings.template_api_key
    channel_number = settings.template_channel_number
    if not api_key or not channel_number:
        raise HTTPException(
            status_code=400, detail="WBOX_TOKEN (or API_KEY) and WBOX_CHANNEL_NUMBER (or CHANNEL_NUMBER) must be configured in environment variables"
        )

    template_name = payload.template_name
    if not template_name:
        raise HTTPException(status_code=400, detail="template_name is required")
    
    basedon = payload.basedon_value or "upload"
    campaign_id = payload.campaign_id

    if basedon == "upload":
        # For upload campaigns, try to get phone_numbers from payload first (matching reference project)
        numbers_str = payload.phone_numbers or ""
        
        # If not in payload, try to fetch from database (campaign_uploads table) as fallback
        if not numbers_str and campaign_id:
            result = await session.execute(
                select(InvCampaignUpload.mobile_no)
                .where(InvCampaignUpload.campaign_id == campaign_id)
            )
            mobile_numbers = result.scalars().all()
            if mobile_numbers:
                logger.info(f"Found {len(mobile_numbers)} phone numbers in database for campaign {campaign_id}")
                # Format numbers with country code prefix (91 for India)
                numbers_str = _format_phone_numbers(mobile_numbers)
                logger.info(f"Formatted phone numbers: {numbers_str[:100]}...")  # Log first 100 chars
            else:
                logger.warning(f"No phone numbers found in database for campaign {campaign_id}")
        
        if not numbers_str:
            raise HTTPException(
                status_code=400,
                detail="phone_numbers is required when basedon_value is 'upload'"
            )
        else:
            logger.info(f"Using phone numbers for upload campaign: {len(numbers_str.split(','))} numbers")
    else:
        if not campaign_id:
            raise HTTPException(status_code=400, detail="campaign_id is required for Customer Base")
        numbers_obj = await _get_eligible_customers(campaign_id, basedon, session)
        numbers_str = numbers_obj.get("numbers", "")
        if not numbers_str:
            raise HTTPException(
                status_code=400, 
                detail=f"No eligible customers found for campaign {campaign_id}. Please check campaign filters."
            )

    # Get template details
    result = await session.execute(
        select(InvTemplateDetail).where(InvTemplateDetail.template_name == template_name)
    )
    template = result.scalar_one_or_none()

    if not template or not template.file_url:
        raise HTTPException(
            status_code=404, detail=f"No file_url found for template {template_name}"
        )

    video_url = template.file_url

    url = f"https://cloudapi.wbbox.in/api/v1.0/messages/send-template/{channel_number}"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "apikey": f"{api_key}",
        "Content-Type": "application/json",
    }

    # Clean phone numbers - preserve country code (already formatted)
    cleaned_numbers = [n.strip() for n in numbers_str.split(",") if n.strip()]

    if not cleaned_numbers:
        raise HTTPException(status_code=400, detail="No valid phone numbers provided")
    
    # Log sending attempt
    logger.info(f"📤 Attempting to send WhatsApp video messages - Template: {template_name}, Recipients: {len(cleaned_numbers)}")
    print(f"📤 Sending WhatsApp video broadcast - Template: {template_name}, Recipients: {len(cleaned_numbers)}")

    # For video templates, send individually as WhatsApp API may require it for reliable delivery
    successful_sends = 0
    failed_sends = 0
    errors = []
    
    for recipient in cleaned_numbers:
        payload_data = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": recipient,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": "en"},
                "components": [
                    {
                        "type": "header",
                        "parameters": [{"type": "video", "video": {"link": video_url}}],
                    }
                ],
            },
        }

        try:
            resp = requests.post(url, json=payload_data, headers=headers, timeout=30)
            resp.raise_for_status()
            response_data = resp.json()
            
            # Check if the API response indicates success
            is_success = (
                resp.status_code == 200 or resp.status_code == 201 or
                response_data.get("success") is True or
                response_data.get("status") == "success" or
                response_data.get("status") == "sent" or
                (isinstance(response_data, dict) and "messages" in response_data) or
                (isinstance(response_data, dict) and "data" in response_data)
            )
            
            if is_success:
                successful_sends += 1
                logger.debug(f"✅ Successfully sent video to {recipient}")
            else:
                failed_sends += 1
                error_msg = response_data.get("error") or response_data.get("message") or "Unknown error"
                errors.append(f"Recipient {recipient}: {error_msg}")
                logger.warning(f"Failed to send video to {recipient}: {error_msg}")
        except Exception as e:
            failed_sends += 1
            error_msg = str(e)
            errors.append(f"Recipient {recipient}: {error_msg}")
            logger.error(f"Error sending video to {recipient}: {error_msg}")
    
    # Log results
    logger.info(f"✅ WhatsApp video broadcast completed - Template: {template_name}, Successful: {successful_sends}, Failed: {failed_sends}")
    print(f"✅ WhatsApp video broadcast completed - Template: {template_name}, Successful: {successful_sends}, Failed: {failed_sends}")
    
    if successful_sends == 0:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to send any video messages. Errors: {', '.join(errors[:5])}"
        )
    
    # Return success response even if some failed
    return {
        "success": True,
        "message": f"Video messages sent: {successful_sends} successful, {failed_sends} failed",
        "template_name": template_name,
        "recipients_count": len(cleaned_numbers),
        "successful_sends": successful_sends,
        "failed_sends": failed_sends,
        "errors": errors[:10] if errors else []
    }
