import http from "./http";
import type { User } from "../types/User";

// Returns the logged-in user (used by the UserBadge)
export const getMe = async (): Promise<User> => {
  const res = await http.get<User>("/users/me");
  return res.data;
};