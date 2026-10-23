import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** All money is stored as integer paise (1 INR = 100 paise). */
const paise = (name: string) => bigint(name, { mode: "number" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ["owner", "admin", "partner", "viewer"]);
export const productStatusEnum = pgEnum("product_status", ["draft", "published", "archived"]);
export const movementTypeEnum = pgEnum("movement_type", [
  "purchase",
  "sale",
  "refund_restock",
  "adjustment",
  "write_off",
]);
export const saleStatusEnum = pgEnum("sale_status", ["completed", "partially_refunded", "refunded"]);
export const customerTypeEnum = pgEnum("customer_type", ["D2C", "B2B"]);
export const sourcingStatusEnum = pgEnum("sourcing_status", [
  "requested",
  "sourcing",
  "quoted",
  "confirmed",
  "purchased",
  "delivered",
  "completed",
  "cancelled",
]);
export const reviewStatusEnum = pgEnum("review_status", ["open", "resolved", "discarded"]);
export const aiStatusEnum = pgEnum("ai_status", ["pending", "saved", "needs_review", "failed"]);

// ───────────── auth ─────────────
export const partners = pgTable("partners", {
  id: id(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("viewer"),
    partnerId: uuid("partner_id").references(() => partners.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sessions_token_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

// ───────────── catalogue ─────────────
export const products = pgTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    brand: text("brand"),
    category: text("category").notNull().default("sneakers"),
    model: text("model"),
    colorway: text("colorway"),
    sku: text("sku"),
    description: text("description"),
    condition: text("condition").notNull().default("new"),
    /** Normalised "brand name" key used to re-use a product when logging repeat purchases. */
    matchKey: text("match_key").notNull(),
    retailPricePaise: paise("retail_price_paise"),
    publicPricePaise: paise("public_price_paise"),
    status: productStatusEnum("status").notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("products_match_idx").on(t.matchKey),
    index("products_status_idx").on(t.status),
    index("products_brand_idx").on(t.brand),
  ],
);

export const productImages = pgTable(
  "product_images",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    position: integer("position").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("product_images_product_idx").on(t.productId)],
);

export const productVariants = pgTable(
  "product_variants",
  {
    id: id(),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
    /** Shoe size, apparel size, watch case dimension, or "OS" for one-size. */
    size: text("size").notNull().default("OS"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("variants_product_size_idx").on(t.productId, t.size)],
);

export const suppliers = pgTable("suppliers", {
  id: id(),
  name: text("name").notNull(),
  country: text("country"),
  contact: text("contact"),
  notes: text("notes"),
  createdAt: createdAt(),
});

export const inventoryLots = pgTable(
  "inventory_lots",
  {
    id: id(),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    quantityAcquired: integer("quantity_acquired").notNull(),
    quantityRemaining: integer("quantity_remaining").notNull(),
    /** Fully landed cost of ONE unit. */
    unitCostPaise: paise("unit_cost_paise").notNull(),
    purchaseDate: timestamp("purchase_date", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull().default("manual"),
    // international landed-cost breakdown (all optional, informational + audit)
    countryOfOrigin: text("country_of_origin"),
    foreignCurrency: text("foreign_currency"),
    foreignUnitPriceMinor: bigint("foreign_unit_price_minor", { mode: "number" }),
    fxRate: numeric("fx_rate", { precision: 18, scale: 6 }),
    internationalShippingPaise: paise("international_shipping_paise"),
    customsDutyPaise: paise("customs_duty_paise"),
    paymentFeesPaise: paise("payment_fees_paise"),
    domesticShippingPaise: paise("domestic_shipping_paise"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("lots_variant_idx").on(t.variantId),
    check("lots_remaining_nonneg", sql`${t.quantityRemaining} >= 0`),
    check("lots_remaining_le_acquired", sql`${t.quantityRemaining} <= ${t.quantityAcquired}`),
    check("lots_cost_nonneg", sql`${t.unitCostPaise} >= 0`),
  ],
);

export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: id(),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    type: movementTypeEnum("type").notNull(),
    /** Signed: positive adds stock, negative removes. */
    quantity: integer("quantity").notNull(),
    refType: text("ref_type"),
    refId: uuid("ref_id"),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("movements_lot_idx").on(t.lotId), index("movements_variant_idx").on(t.variantId)],
);

// ───────────── CRM ─────────────
export const customers = pgTable(
  "customers",
  {
    id: id(),
    name: text("name").notNull(),
    phone: text("phone"),
    instagram: text("instagram"),
    email: text("email"),
    city: text("city"),
    type: customerTypeEnum("type").notNull().default("D2C"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("customers_phone_idx").on(t.phone)],
);

// ───────────── AI log + review ─────────────
export const aiLogRequests = pgTable(
  "ai_log_requests",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    idempotencyKey: text("idempotency_key").notNull(),
    inputText: text("input_text").notNull().default(""),
    imageKeys: jsonb("image_keys").$type<string[]>().notNull().default([]),
    status: aiStatusEnum("status").notNull().default("pending"),
    model: text("model"),
    rawResponse: jsonb("raw_response"),
    parsed: jsonb("parsed"),
    outcome: jsonb("outcome"),
    elapsedMs: integer("elapsed_ms"),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ai_requests_idem_idx").on(t.idempotencyKey)],
);

export const reviewQueue = pgTable(
  "review_queue",
  {
    id: id(),
    aiRequestId: uuid("ai_request_id").references(() => aiLogRequests.id),
    status: reviewStatusEnum("status").notNull().default("open"),
    inputText: text("input_text").notNull().default(""),
    imageKeys: jsonb("image_keys").$type<string[]>().notNull().default([]),
    interpretedType: text("interpreted_type").notNull().default("unclear"),
    extracted: jsonb("extracted").$type<Record<string, unknown>>().notNull().default({}),
    missing: jsonb("missing").$type<string[]>().notNull().default([]),
    problems: jsonb("problems").$type<string[]>().notNull().default([]),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    candidates: jsonb("candidates").$type<unknown[]>().notNull().default([]),
    resolvedBy: uuid("resolved_by").references(() => users.id),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resultRef: text("result_ref"),
    createdAt: createdAt(),
  },
  (t) => [index("review_status_idx").on(t.status)],
);

// ───────────── purchases & sales ─────────────
export const purchaseTransactions = pgTable(
  "purchase_transactions",
  {
    id: id(),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    idempotencyKey: text("idempotency_key").notNull(),
    totalCostPaise: paise("total_cost_paise").notNull(),
    shippingPaise: paise("shipping_paise").notNull().default(0),
    quantity: integer("quantity").notNull(),
    source: text("source").notNull().default("manual"),
    aiRequestId: uuid("ai_request_id").references(() => aiLogRequests.id),
    reviewId: uuid("review_id").references(() => reviewQueue.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("purchase_idem_idx").on(t.idempotencyKey)],
);

export const sales = pgTable(
  "sales",
  {
    id: id(),
    /** Sequential number shown on invoices (INV-0001…). Assigned by the database, never reused. */
    invoiceSeq: integer("invoice_seq").generatedAlwaysAsIdentity(),
    customerId: uuid("customer_id").references(() => customers.id),
    channel: text("channel").notNull().default("whatsapp"),
    saleDate: timestamp("sale_date", { withTimezone: true }).notNull().defaultNow(),
    idempotencyKey: text("idempotency_key").notNull(),
    discountPaise: paise("discount_paise").notNull().default(0),
    shippingRevenuePaise: paise("shipping_revenue_paise").notNull().default(0),
    shippingCostPaise: paise("shipping_cost_paise").notNull().default(0),
    feesPaise: paise("fees_paise").notNull().default(0),
    otherExpensesPaise: paise("other_expenses_paise").notNull().default(0),
    grossRevenuePaise: paise("gross_revenue_paise").notNull(),
    netProceedsPaise: paise("net_proceeds_paise").notNull(),
    cogsPaise: paise("cogs_paise").notNull(),
    profitPaise: paise("profit_paise").notNull(),
    status: saleStatusEnum("status").notNull().default("completed"),
    notes: text("notes"),
    source: text("source").notNull().default("manual"),
    aiRequestId: uuid("ai_request_id").references(() => aiLogRequests.id),
    reviewId: uuid("review_id").references(() => reviewQueue.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sales_idem_idx").on(t.idempotencyKey),
    index("sales_date_idx").on(t.saleDate),
    index("sales_customer_idx").on(t.customerId),
  ],
);

export const saleItems = pgTable(
  "sale_items",
  {
    id: id(),
    saleId: uuid("sale_id").notNull().references(() => sales.id, { onDelete: "cascade" }),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    variantId: uuid("variant_id").notNull().references(() => productVariants.id),
    quantity: integer("quantity").notNull(),
    unitPricePaise: paise("unit_price_paise").notNull(),
    unitCostPaise: paise("unit_cost_paise").notNull(),
    /** Share of the sale-level discount allocated to this line. */
    discountPaise: paise("discount_paise").notNull().default(0),
    refundedQuantity: integer("refunded_quantity").notNull().default(0),
    refundedAmountPaise: paise("refunded_amount_paise").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("sale_items_sale_idx").on(t.saleId),
    index("sale_items_lot_idx").on(t.lotId),
    check("sale_items_qty_pos", sql`${t.quantity} > 0`),
  ],
);

export const saleExpenses = pgTable("sale_expenses", {
  id: id(),
  saleId: uuid("sale_id").notNull().references(() => sales.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  amountPaise: paise("amount_paise").notNull(),
});

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    saleId: uuid("sale_id").notNull().references(() => sales.id),
    saleItemId: uuid("sale_item_id").notNull().references(() => saleItems.id),
    quantity: integer("quantity").notNull(),
    refundAmountPaise: paise("refund_amount_paise").notNull(),
    restock: boolean("restock").notNull(),
    cogsRestoredPaise: paise("cogs_restored_paise").notNull().default(0),
    /** Signed change to realised profit (usually negative). */
    profitDeltaPaise: paise("profit_delta_paise").notNull(),
    reason: text("reason"),
    idempotencyKey: text("idempotency_key").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("refunds_idem_idx").on(t.idempotencyKey)],
);

// ───────────── partners & finance ─────────────
export const lotOwnershipAllocations = pgTable(
  "lot_ownership_allocations",
  {
    id: id(),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id, { onDelete: "cascade" }),
    partnerId: uuid("partner_id").notNull().references(() => partners.id),
    /** Basis points of capital contributed (10000 = 100%). */
    ownershipBps: integer("ownership_bps").notNull(),
    /** Basis points of profit this partner receives. */
    profitShareBps: integer("profit_share_bps").notNull(),
  },
  (t) => [
    uniqueIndex("lot_owner_idx").on(t.lotId, t.partnerId),
    check("bps_range", sql`${t.ownershipBps} between 0 and 10000 and ${t.profitShareBps} between 0 and 10000`),
  ],
);

export const lotProfitAllocations = pgTable(
  "lot_profit_allocations",
  {
    id: id(),
    saleId: uuid("sale_id").notNull().references(() => sales.id),
    saleItemId: uuid("sale_item_id").notNull().references(() => saleItems.id),
    refundId: uuid("refund_id").references(() => refunds.id),
    lotId: uuid("lot_id").notNull().references(() => inventoryLots.id),
    /** null = the business owner's retained share. */
    partnerId: uuid("partner_id").references(() => partners.id),
    profitPaise: paise("profit_paise").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("profit_alloc_partner_idx").on(t.partnerId), index("profit_alloc_sale_idx").on(t.saleId)],
);

export const capitalContributions = pgTable("capital_contributions", {
  id: id(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  amountPaise: paise("amount_paise").notNull(),
  contributedOn: timestamp("contributed_on", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
  createdAt: createdAt(),
});

export const partnerDistributions = pgTable("partner_distributions", {
  id: id(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  amountPaise: paise("amount_paise").notNull(),
  paidOn: timestamp("paid_on", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
  createdAt: createdAt(),
});

// ───────────── sourcing, imports, ops ─────────────
export const sourcingRequests = pgTable("sourcing_requests", {
  id: id(),
  customerId: uuid("customer_id").references(() => customers.id),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  product: text("product").notNull(),
  desiredSize: text("desired_size"),
  budgetPaise: paise("budget_paise"),
  quotedPricePaise: paise("quoted_price_paise"),
  estimatedCostPaise: paise("estimated_cost_paise"),
  depositPaise: paise("deposit_paise").notNull().default(0),
  depositReceived: boolean("deposit_received").notNull().default(false),
  status: sourcingStatusEnum("status").notNull().default("requested"),
  deliveryStatus: text("delivery_status"),
  saleId: uuid("sale_id").references(() => sales.id),
  lotId: uuid("lot_id").references(() => inventoryLots.id),
  notes: text("notes"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const productImports = pgTable("product_imports", {
  id: id(),
  url: text("url").notNull(),
  status: text("status").notNull().default("extracted"),
  extracted: jsonb("extracted").$type<Record<string, unknown>>(),
  productId: uuid("product_id").references(() => products.id),
  error: text("error"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity"),
    entityId: text("entity_id"),
    detail: jsonb("detail"),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt)],
);

export const businessSettings = pgTable("business_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});
