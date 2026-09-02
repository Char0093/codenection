export type ProviderStatus = "ok" | "degraded" | "mocked" | "failed";

export type ProviderResult<T> = {
  data: T;
  provider: string;
  status: ProviderStatus;
  fetchedAt: string;
  fallbackMessage?: string;
};

export interface WeatherProvider {
  getForecast(latitude: number, longitude: number, startDate: string, endDate: string): Promise<ProviderResult<unknown>>;
}

export interface PlaceProvider {
  search(query: string): Promise<ProviderResult<unknown[]>>;
}
