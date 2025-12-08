import http from "./http";

export interface Template {
  id?: number;
  name: string;
  template_type?: string;
  templateType?: string;
  templateCreateStatus?: string;
  Status?: string;
  category?: string;
  media_type?: string;
}

export interface TemplateCreateRequest {
  name: string;
  language: string;
  category: string;
  components: Array<{
    type: string;
    format?: string;
    text?: string;
    example?: any;
  }>;
}

export interface TemplateSyncRequest {
  name: string;
}

export interface TemplateSendRequest {
  template_name: string;
  phone_numbers?: string;
  basedon_value?: string;
  campaign_id?: number;
}

export interface TemplateDetail {
  template_name: string;
  template_type: string;
  media_type?: string;
  file_url?: string;
  file_hvalue?: string;
  uploaded_at: string;
}

export interface TemplateListResponse {
  templates?: Template[];
  data?: Template[];
}

export async function getAllTemplates(): Promise<Template[]> {
  const response = await http.get<TemplateListResponse>("/campaign/templates/getAlltemplates");
  const data = response.data;
  console.log("API Response:", data);
  const templates = (data.templates || data.data || []) as Template[];
  console.log("Extracted templates:", templates);
  return templates;
}

export async function createTextTemplate(payload: TemplateCreateRequest): Promise<any> {
  return http.post("/campaign/templates/create-text-template", payload);
}

export async function createImageTemplate(formData: FormData): Promise<any> {
  return http.post("/campaign/templates/create-image-template", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
}

export async function createVideoTemplate(formData: FormData): Promise<any> {
  return http.post("/campaign/templates/create-video-template", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
}

export async function syncTemplate(payload: TemplateSyncRequest): Promise<any> {
  return http.post("/campaign/templates/sync-template", payload);
}

export async function getTemplateDetails(templateName: string): Promise<TemplateDetail> {
  return http.get(`/campaign/templates/${templateName}/details`);
}

export async function sendWhatsAppText(payload: TemplateSendRequest): Promise<any> {
  return http.post("/campaign/templates/sendWatsAppText", payload);
}

export async function sendWhatsAppImage(payload: TemplateSendRequest): Promise<any> {
  return http.post("/campaign/templates/sendWatsAppImage", payload);
}

export async function sendWhatsAppVideo(payload: TemplateSendRequest): Promise<any> {
  return http.post("/campaign/templates/sendWatsAppVideo", payload);
}

export async function downloadUploadTemplate(): Promise<Blob> {
  const response = await http.get<Blob>("/campaign/upload/template", {
    responseType: "blob",
  });
  return response.data;
}

