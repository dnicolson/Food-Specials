export interface OfferItem {
  name: string;
  price: number | null;
  link: string | null;
  offer: string;
  max_redemptions: number | null;
}

export interface OfferStore {
  id: string;
  name: string;
  link: string;
  offers: string[];
  items: OfferItem[];
  currency: string | null;
  menu_available: boolean;
}

export interface OfferSnapshot {
  fetched_at: string;
  total_offer_stores: number;
  stores: OfferStore[];
}

export function fetchOffers(
  location: { latitude: number; longitude: number; locale?: string; limit?: number },
  options?: { runtimeDir?: string; python?: string; source?: string },
): Promise<OfferSnapshot>;
