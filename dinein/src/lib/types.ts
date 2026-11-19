/**
 * Dine-in API shapes, mirroring `server/src/modules/dining`. Money is always
 * integer paise; dates arrive as ISO strings.
 */

export type OfferAppliesTo = 'prebook' | 'walkin' | 'both';

export interface SlotView {
  id: string;
  startsAt: string;
  time: string;
  remaining: number;
  maxParty: number;
  offer: { id: string; label: string; percentOff: number | null; flatOffPaise: number | null } | null;
  available?: boolean;
}

export interface RestaurantCard {
  id: string;
  slug: string;
  name: string;
  locality: string;
  city: { name: string; slug: string };
  cuisines: string[];
  tags: string[];
  costForTwoPaise: number;
  coverUrl: string | null;
  logoUrl: string | null;
  rating: number;
  ratingCount: number;
  payBillEnabled: boolean;
  bookingEnabled: boolean;
  isFeatured: boolean;
  openNow: boolean;
  closesAt: string | null;
  distanceKm: number | null;
  bestOffer: { label: string; appliesTo: OfferAppliesTo; percentOff: number | null; flatOffPaise: number | null } | null;
  nextSlots?: SlotView[];
}

export interface Offer {
  id: string;
  owner: 'restaurant' | 'platform' | 'bank' | 'membership';
  code: string | null;
  title: string;
  description: string | null;
  kind: 'percent' | 'flat';
  percentOff: number | null;
  flatOffPaise: number | null;
  maxDiscountPaise: number | null;
  minBillPaise: number;
  appliesTo: OfferAppliesTo;
  days: number[];
  startTime: string;
  endTime: string;
  schedule: string;
  validUntil: string | null;
  perUserLimit: number | null;
  restaurantFundedPct: number;
  terms: string | null;
  status: 'draft' | 'active' | 'paused' | 'archived';
  bankName?: string | null;
  paymentMethods?: string[];
}

export interface RestaurantDetail extends RestaurantCard {
  description: string | null;
  address: string;
  phone: string | null;
  lat: number;
  lng: number;
  hours: Record<string, Array<[string, string]>>;
  opensAt: string | null;
  serviceChargePercent: number;
  coverChargePerGuestPaise: number;
  timezone: string;
  gallery: Array<{ kind: string; url: string; caption: string | null }>;
  offers: Offer[];
  reviews: Array<{
    id: string;
    rating: number;
    body: string | null;
    reply: string | null;
    createdAt: string;
    author: string;
    photos: ReviewPhoto[];
  }>;
  dinerPhotos: Array<ReviewPhoto & { author: string; createdAt: string }>;
  menuItemCount: number;
  ratingDistribution: Array<{ stars: number; count: number }>;
}

export interface ReviewPhoto {
  id: string;
  url: string;
}

export type Diet = 'veg' | 'non_veg' | 'egg' | 'vegan';
export type MenuBadge = 'bestseller' | 'chef_special' | 'new' | 'signature';

export interface MenuItem {
  id: string;
  sectionId: string;
  name: string;
  description: string | null;
  pricePaise: number;
  diet: Diet;
  spiceLevel: number;
  badges: MenuBadge[];
  imageUrl: string | null;
  isAvailable: boolean;
}

export interface MenuSection {
  id: string;
  name: string;
  description: string | null;
  items: MenuItem[];
}

export interface HomeFeed {
  city: { id: string; name: string; slug: string };
  restaurantCount: number;
  tonight: RestaurantCard[];
  bestOffers: RestaurantCard[];
  topRated: RestaurantCard[];
  collections: Array<{ slug: string; title: string; subtitle: string | null; coverUrl: string | null; count: number }>;
  cuisines: Array<{ name: string; count: number }>;
}

export interface CollectionPage {
  slug: string;
  title: string;
  subtitle: string | null;
  coverUrl: string | null;
  restaurants: RestaurantCard[];
}

export type ReservationStatus =
  | 'pending_payment'
  | 'placed'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'cancelled_by_diner'
  | 'cancelled_by_restaurant'
  | 'no_show'
  | 'expired';

export interface Reservation {
  id: string;
  code: string;
  status: ReservationStatus;
  startsAt: string;
  localDate: string;
  partySize: number;
  occasion: string | null;
  notes: string | null;
  guestName: string;
  offer: { title: string; headline: string } | null;
  restaurant: {
    id: string;
    slug: string;
    name: string;
    locality: string;
    address: string;
    coverUrl: string | null;
    phone: string | null;
    lat: number;
    lng: number;
  };
  canCancel: boolean;
  deposit: {
    amountPaise: number;
    status: 'none' | 'pending' | 'paid' | 'credited' | 'refunded' | 'forfeited';
    holdExpiresAt: string | null;
    refundableNow: boolean;
  } | null;
  createdAt: string;
  acceptedAt: string | null;
  seatedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface PricingLine {
  key: string;
  label: string;
  amountPaise: number;
  fundedBy?: 'restaurant' | 'platform' | 'bank' | 'shared';
  note?: string;
}

export interface BillPricing {
  engineVersion: string;
  billTotalPaise: number;
  nonDiscountablePaise: number;
  restaurantOffer: { title: string; discountPaise: number } | null;
  coupon: { code: string | null; title: string; discountPaise: number } | null;
  couponError: string | null;
  bankOffer: { title: string; bankName: string | null; discountPaise: number } | null;
  bankOfferError: string | null;
  coverCreditPaise: number;
  walletUsedPaise: number;
  serviceChargePaise: number;
  tipPaise: number;
  convenienceFeePaise: number;
  totalDiscountPaise: number;
  amountPayablePaise: number;
  lines: PricingLine[];
}

export interface BankOption {
  id: string;
  title: string;
  bankName: string | null;
  paymentMethods: string[];
  unavailableReason: string | null;
}

export interface BillQuote extends BillPricing {
  mode: 'prebook' | 'walkin';
  bankOptions: BankOption[];
  walletAvailablePaise: number;
  coverDepositPaise: number;
}

export interface Wallet {
  availablePaise: number;
  pendingPaise: number;
  expiringSoonPaise: number;
  nextExpiry: string | null;
  lifetimeEarnedPaise: number;
  activity: Array<{
    kind: 'cashback' | 'cashback_pending' | 'cashback_reversed' | 'cashback_expired' | 'spent';
    amountPaise: number;
    at: string;
    label: string | null;
    availableAt: string | null;
  }>;
}

export interface DepositCheckout {
  code: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string | null;
  mockMode: boolean;
  mockPaymentId?: string;
  mockSignature?: string;
  restaurantName: string;
  holdExpiresAt: string | null;
  prefill: { name: string; email: string; contact: string };
}

export type BillStatus = 'pending_payment' | 'paid' | 'verified' | 'disputed' | 'failed' | 'cancelled' | 'refunded';

export interface Bill {
  id: string;
  code: string;
  status: BillStatus;
  restaurant: { id: string; slug: string; name: string; locality: string; coverUrl: string | null; logoUrl: string | null };
  reservationCode: string | null;
  pricing: BillPricing;
  amountPaidPaise: number;
  pass: { code: string; stepEndsAt: string; stepSeconds: number; serverNow: string } | null;
  verifiedAt: string | null;
  verificationMethod: string | null;
  disputeReason: string | null;
  paidAt: string | null;
  createdAt: string;
  canReview: boolean;
}

export interface BillCheckout {
  code: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string | null;
  mockMode: boolean;
  mockPaymentId?: string;
  mockSignature?: string;
  restaurantName: string;
  prefill: { name: string; email: string; contact: string };
}

/* ── partner ── */

export type Capability =
  | 'bills.verify'
  | 'reservations.manage'
  | 'offers.manage'
  | 'availability.manage'
  | 'menu.manage'
  | 'reviews.manage'
  | 'payouts.view'
  | 'insights.view';

export interface PartnerRestaurant {
  id: string;
  slug: string;
  name: string;
  locality: string;
  coverUrl: string | null;
  status: string;
  role: 'owner' | 'manager' | 'host' | 'cashier' | 'admin';
  capabilities: Capability[];
}

export interface PartnerBill {
  code: string;
  status: BillStatus;
  billTotalPaise: number;
  amountPaidPaise: number;
  totalDiscountPaise: number;
  restaurantPayoutPaise: number;
  dinerName: string;
  phoneLast4: string | null;
  reservationCode: string | null;
  passCode: string | null;
  stepEndsAt: string | null;
  paidAt: string | null;
  verifiedAt: string | null;
  verificationMethod: string | null;
  disputeReason: string | null;
}

export interface PartnerLive {
  restaurant: { id: string; name: string; role: PartnerRestaurant['role'] };
  summary: {
    date: string;
    billsPaid: number;
    grossSalesPaise: number;
    billsToVerify: number;
    payoutEarnedPaise: number;
    covers: number;
    tables: number;
    pendingRequests: number;
  };
  bills: PartnerBill[];
  reservations: Reservation[];
  serverNow: string;
}

export interface Payouts {
  balancePaise: number;
  movements: Array<{ kind: string; memo: string | null; occurredAt: string; amountPaise: number }>;
  settlements: Array<{ reference: string; amountPaise: number; utr: string | null; status: string; createdAt: string }>;
}

export interface AvailabilityRule {
  weekday: number;
  startTime: string;
  endTime: string;
  slotMinutes: 15 | 30 | 45 | 60;
  coversPerSlot: number;
  maxParty: number;
}

export interface Availability {
  settings: { autoAccept: boolean; bookingEnabled: boolean; payBillEnabled: boolean; coverChargePerGuestPaise: number };
  rules: AvailabilityRule[];
  closedDates: string[];
}

/* ── admin ── */

export interface AdminRestaurantRow {
  id: string;
  slug: string;
  name: string;
  locality: string;
  city: string;
  status: 'draft' | 'pending_review' | 'live' | 'paused' | 'delisted';
  commissionPercent: number;
  members: number;
}

export interface AdminRestaurant {
  id: string;
  slug: string;
  name: string;
  locality: string;
  address: string;
  city: string;
  status: AdminRestaurantRow['status'];
  coverUrl: string | null;
  commissionPercent: number;
  serviceChargePercent: number;
  gstin: string | null;
  fssai: string | null;
  razorpayAccountId: string | null;
  routePayouts: boolean;
  createdAt: string;
  payableBalancePaise: number;
  lifetime: { bills: number; grossPaise: number; commissionPaise: number };
  members: Array<{ userId: string; fullName: string; email: string; role: 'owner' | 'manager' | 'host' | 'cashier' }>;
}

export interface AdminOffer extends Offer {
  redemptions: number;
  discountGivenPaise: number;
}
