import http from "./http";

export interface Currency {
  currency_code: string;
  currency_name: string;
}

export const listCurrencies = () =>
  http.get<Currency[]>("/currencies").then((response) => response.data);