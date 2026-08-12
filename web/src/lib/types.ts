/** Shared response shapes, mirroring the API's serialisers. */

export type Role = 'admin' | 'organizer' | 'customer';

export interface User {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  status: string;
  avatarUrl: string | null;
  cityId: string | null;
  emailVerified: boolean;
  createdAt: string;
  organizer?: { id: string; displayName: string; slug: string; status: string } | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  color: string;
  imageUrl?: string | null;
  description?: string | null;
  eventCount?: number;
}

export interface City {
  id: string;
  name: string;
  slug: string;
  state: string;
  imageUrl: string | null;
  isPopular?: boolean;
  eventCount?: number;
}

export interface EventCard {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  bannerUrl: string | null;
  thumbnailUrl: string | null;
  startsAt: string;
  endsAt: string;
  isFree: boolean;
  isFeatured: boolean;
  minPricePaise: number;
  maxPricePaise: number;
  ticketsSold: number;
  totalCapacity: number;
  ticketsAvailable: number;
  soldOut: boolean;
  status?: string;
  category: { id: string; name: string; slug: string; color: string; icon: string | null };
  city: { id: string; name: string; slug: string };
  venue: { id: string; name: string };
  organizer: { id: string; name: string; slug: string };
}

export interface TicketType {
  id: string;
  name: string;
  kind: string;
  description: string | null;
  pricePaise: number;
  quantityTotal: number;
  available: number;
  minPerOrder: number;
  maxPerOrder: number;
  seatsPerTicket: number;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  isActive: boolean;
  onSale: boolean;
  saleStatus: 'on_sale' | 'not_started' | 'ended' | 'sold_out' | 'inactive';
}

export interface EventDetail {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string;
  bannerUrl: string | null;
  thumbnailUrl: string | null;
  gallery: string[];
  startsAt: string;
  endsAt: string;
  doorsOpenAt: string | null;
  timezone: string;
  language: string;
  durationMinutes: number | null;
  ageLimit: number | null;
  status: string;
  isFeatured: boolean;
  isFree: boolean;
  terms: string | null;
  tags: string[];
  minPricePaise: number;
  maxPricePaise: number;
  totalCapacity: number;
  ticketsSold: number;
  viewCount: number;
  rejectionReason: string | null;
  category: { id: string; name: string; slug: string; color: string; icon: string | null };
  city: { id: string; name: string; slug: string; state: string };
  venue: {
    id: string;
    name: string;
    addressLine1: string;
    addressLine2: string | null;
    landmark: string | null;
    postalCode: string | null;
    latitude: number | null;
    longitude: number | null;
    googleMapsUrl: string | null;
    capacity: number | null;
  };
  organizer: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    bio: string | null;
    email: string | null;
    phone: string | null;
    website: string | null;
    status: string;
  };
  ticketTypes: TicketType[];
}

/** A promo a shopper can actually use on this event, surfaced at checkout. */
export interface AvailableCoupon {
  code: string;
  description: string | null;
  type: 'percent' | 'flat';
  value: number;
  maxDiscountPaise: number | null;
  minOrderPaise: number;
  validUntil: string | null;
  /** Pre-formatted summary from the API, e.g. "25% off, up to ₹500". */
  label: string;
}

export interface PriceBreakdown {
  quantity: number;
  subtotalPaise: number;
  discountPaise: number;
  taxablePaise: number;
  taxPaise: number;
  convenienceFeePaise: number;
  totalPaise: number;
  commissionPercent: number;
  commissionPaise: number;
  organizerPayoutPaise: number;
  couponCode?: string;
  couponError?: string;
  lines: Array<{
    ticketTypeId: string;
    name: string;
    unitPricePaise: number;
    quantity: number;
    subtotalPaise: number;
  }>;
}

export interface CreatedBooking {
  id: string;
  bookingCode: string;
  status: string;
  totalPaise: number;
  holdExpiresAt: string | null;
  requiresPayment: boolean;
  breakdown: PriceBreakdown;
}

export interface CheckoutSession {
  bookingId: string;
  bookingCode: string;
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string | null;
  mockMode: boolean;
  mockPaymentId?: string;
  mockSignature?: string;
  prefill: { name: string; email: string; contact: string };
  eventTitle: string;
}

export interface BookingSummary {
  id: string;
  bookingCode: string;
  status: string;
  quantity: number;
  totalPaise: number;
  createdAt: string;
  confirmedAt: string | null;
  validTickets: number;
  event: {
    id: string;
    title: string;
    slug: string;
    startsAt: string;
    bannerUrl: string | null;
    thumbnailUrl: string | null;
    timezone: string;
    venueName: string;
    cityName: string;
  };
}

export interface BookingDetail {
  id: string;
  bookingCode: string;
  status: string;
  quantity: number;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  convenienceFeePaise: number;
  totalPaise: number;
  refundedPaise: number;
  couponCode: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  notes: string | null;
  holdExpiresAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  event: {
    id: string;
    title: string;
    slug: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    bannerUrl: string | null;
    thumbnailUrl: string | null;
    venueName: string;
    addressLine1: string;
    addressLine2: string | null;
    cityName: string;
    latitude: number | null;
    longitude: number | null;
    googleMapsUrl: string | null;
  };
  organizer: { name: string; email: string | null; phone: string | null };
  items: Array<{
    id: string;
    ticketTypeId: string;
    name: string;
    unitPricePaise: number;
    quantity: number;
    subtotalPaise: number;
  }>;
  tickets: Array<{
    id: string;
    ticketCode: string;
    attendeeName: string;
    status: string;
    seatLabel: string | null;
    checkedInAt: string | null;
  }>;
  payments: Array<{
    id: string;
    provider: string;
    orderId: string | null;
    paymentId: string | null;
    amountPaise: number;
    status: string;
    method: string;
    createdAt: string;
  }>;
}

export interface TicketView {
  id: string;
  ticketCode: string;
  attendeeName: string;
  seatLabel: string | null;
  status: string;
  checkedInAt: string | null;
  qrPayload: string;
  qrDataUrl: string;
  bookingCode: string;
  ticketTypeName: string;
  event: {
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    timezone: string;
    venueName: string;
    addressLine1: string;
    cityName: string;
  };
}

export interface HomeFeed {
  trending: EventCard[];
  upcoming: EventCard[];
  featured: EventCard[];
  freeEvents: EventCard[];
  popularCities: City[];
  categories: Category[];
}

export interface OrganizerSummary {
  totalEvents: number;
  publishedEvents: number;
  pendingEvents: number;
  upcomingEvents: number;
  ticketsSold: number;
  totalBookings: number;
  grossRevenuePaise: number;
  netRevenuePaise: number;
  commissionPaise: number;
  refundedPaise: number;
  attendanceRate: number;
}

export interface AdminSummary {
  totalUsers: number;
  totalCustomers: number;
  totalOrganizers: number;
  pendingOrganizers: number;
  totalEvents: number;
  publishedEvents: number;
  pendingEvents: number;
  totalBookings: number;
  ticketsSold: number;
  grossRevenuePaise: number;
  commissionEarnedPaise: number;
  refundedPaise: number;
  pendingRefunds: number;
  newUsersThisMonth: number;
}

export interface SalesPoint {
  date: string;
  bookings: number;
  tickets: number;
  revenuePaise: number;
}

export interface RevenuePoint {
  date: string;
  grossPaise: number;
  commissionPaise: number;
  bookings: number;
}

export interface EventPerformance {
  id: string;
  title: string;
  slug: string;
  startsAt: string;
  status: string;
  capacity: number;
  ticketsSold: number;
  bookings: number;
  checkedIn: number;
  revenuePaise: number;
  payoutPaise: number;
  sellThrough: number;
}

export interface CheckInResult {
  status: 'admitted' | 'already_used' | 'invalid' | 'wrong_event' | 'cancelled';
  message: string;
  ticket?: {
    ticketCode: string;
    attendeeName: string;
    ticketTypeName: string;
    seatLabel: string | null;
    bookingCode: string;
    checkedInAt: string | null;
    eventTitle: string;
  };
}

export interface PlatformSettings {
  commission_percent: number;
  tax_percent: number;
  convenience_fee_percent: number;
  booking_hold_minutes: number;
  refund_window_hours: number;
  support_email: string;
  platform_name: string;
  auto_approve_events: boolean;
}
