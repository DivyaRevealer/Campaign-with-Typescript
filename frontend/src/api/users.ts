import http from "./http";
export async function getMe() {
  const r = await http.get("/users/me");
  return r.data; // { inv_user_code, inv_user_name, inv_display_name }
}