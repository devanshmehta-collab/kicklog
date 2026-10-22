CREATE TYPE "public"."ai_status" AS ENUM('pending', 'saved', 'needs_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('D2C', 'B2B');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('purchase', 'sale', 'refund_restock', 'adjustment', 'write_off');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('open', 'resolved', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'partner', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('completed', 'partially_refunded', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."sourcing_status" AS ENUM('requested', 'sourcing', 'quoted', 'confirmed', 'purchased', 'delivered', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "ai_log_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"idempotency_key" text NOT NULL,
	"input_text" text DEFAULT '' NOT NULL,
	"image_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "ai_status" DEFAULT 'pending' NOT NULL,
	"model" text,
	"raw_response" jsonb,
	"parsed" jsonb,
	"outcome" jsonb,
	"elapsed_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text,
	"entity_id" text,
	"detail" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "capital_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"contributed_on" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"instagram" text,
	"email" text,
	"city" text,
	"type" "customer_type" DEFAULT 'D2C' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"supplier_id" uuid,
	"quantity_acquired" integer NOT NULL,
	"quantity_remaining" integer NOT NULL,
	"unit_cost_paise" bigint NOT NULL,
	"purchase_date" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"country_of_origin" text,
	"foreign_currency" text,
	"foreign_unit_price_minor" bigint,
	"fx_rate" numeric(18, 6),
	"international_shipping_paise" bigint,
	"customs_duty_paise" bigint,
	"payment_fees_paise" bigint,
	"domestic_shipping_paise" bigint,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lots_remaining_nonneg" CHECK ("inventory_lots"."quantity_remaining" >= 0),
	CONSTRAINT "lots_remaining_le_acquired" CHECK ("inventory_lots"."quantity_remaining" <= "inventory_lots"."quantity_acquired"),
	CONSTRAINT "lots_cost_nonneg" CHECK ("inventory_lots"."unit_cost_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "inventory_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"type" "movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lot_ownership_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"ownership_bps" integer NOT NULL,
	"profit_share_bps" integer NOT NULL,
	CONSTRAINT "bps_range" CHECK ("lot_ownership_allocations"."ownership_bps" between 0 and 10000 and "lot_ownership_allocations"."profit_share_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "lot_profit_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"refund_id" uuid,
	"lot_id" uuid NOT NULL,
	"partner_id" uuid,
	"profit_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_distributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"amount_paise" bigint NOT NULL,
	"paid_on" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"url" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"status" text DEFAULT 'extracted' NOT NULL,
	"extracted" jsonb,
	"product_id" uuid,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"size" text DEFAULT 'OS' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"category" text DEFAULT 'sneakers' NOT NULL,
	"model" text,
	"colorway" text,
	"sku" text,
	"description" text,
	"condition" text DEFAULT 'new' NOT NULL,
	"match_key" text NOT NULL,
	"retail_price_paise" bigint,
	"public_price_paise" bigint,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"total_cost_paise" bigint NOT NULL,
	"shipping_paise" bigint DEFAULT 0 NOT NULL,
	"quantity" integer NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"ai_request_id" uuid,
	"review_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_item_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"refund_amount_paise" bigint NOT NULL,
	"restock" boolean NOT NULL,
	"cogs_restored_paise" bigint DEFAULT 0 NOT NULL,
	"profit_delta_paise" bigint NOT NULL,
	"reason" text,
	"idempotency_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_request_id" uuid,
	"status" "review_status" DEFAULT 'open' NOT NULL,
	"input_text" text DEFAULT '' NOT NULL,
	"image_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interpreted_type" text DEFAULT 'unclear' NOT NULL,
	"extracted" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" numeric(4, 3),
	"candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"result_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount_paise" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_paise" bigint NOT NULL,
	"unit_cost_paise" bigint NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"refunded_quantity" integer DEFAULT 0 NOT NULL,
	"refunded_amount_paise" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sale_items_qty_pos" CHECK ("sale_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"channel" text DEFAULT 'whatsapp' NOT NULL,
	"sale_date" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text NOT NULL,
	"discount_paise" bigint DEFAULT 0 NOT NULL,
	"shipping_revenue_paise" bigint DEFAULT 0 NOT NULL,
	"shipping_cost_paise" bigint DEFAULT 0 NOT NULL,
	"fees_paise" bigint DEFAULT 0 NOT NULL,
	"other_expenses_paise" bigint DEFAULT 0 NOT NULL,
	"gross_revenue_paise" bigint NOT NULL,
	"net_proceeds_paise" bigint NOT NULL,
	"cogs_paise" bigint NOT NULL,
	"profit_paise" bigint NOT NULL,
	"status" "sale_status" DEFAULT 'completed' NOT NULL,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"ai_request_id" uuid,
	"review_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourcing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid,
	"supplier_id" uuid,
	"product" text NOT NULL,
	"desired_size" text,
	"budget_paise" bigint,
	"quoted_price_paise" bigint,
	"estimated_cost_paise" bigint,
	"deposit_paise" bigint DEFAULT 0 NOT NULL,
	"deposit_received" boolean DEFAULT false NOT NULL,
	"status" "sourcing_status" DEFAULT 'requested' NOT NULL,
	"delivery_status" text,
	"sale_id" uuid,
	"lot_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"contact" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"partner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_log_requests" ADD CONSTRAINT "ai_log_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_contributions" ADD CONSTRAINT "capital_contributions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_ownership_allocations" ADD CONSTRAINT "lot_ownership_allocations_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_ownership_allocations" ADD CONSTRAINT "lot_ownership_allocations_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_profit_allocations" ADD CONSTRAINT "lot_profit_allocations_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_profit_allocations" ADD CONSTRAINT "lot_profit_allocations_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_profit_allocations" ADD CONSTRAINT "lot_profit_allocations_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_profit_allocations" ADD CONSTRAINT "lot_profit_allocations_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_profit_allocations" ADD CONSTRAINT "lot_profit_allocations_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_distributions" ADD CONSTRAINT "partner_distributions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_imports" ADD CONSTRAINT "product_imports_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_imports" ADD CONSTRAINT "product_imports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_ai_request_id_ai_log_requests_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_log_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_review_id_review_queue_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."review_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_transactions" ADD CONSTRAINT "purchase_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_sale_item_id_sale_items_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_ai_request_id_ai_log_requests_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_log_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_expenses" ADD CONSTRAINT "sale_expenses_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_ai_request_id_ai_log_requests_id_fk" FOREIGN KEY ("ai_request_id") REFERENCES "public"."ai_log_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_review_id_review_queue_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."review_queue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_requests" ADD CONSTRAINT "sourcing_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_requests" ADD CONSTRAINT "sourcing_requests_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_requests" ADD CONSTRAINT "sourcing_requests_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_requests" ADD CONSTRAINT "sourcing_requests_lot_id_inventory_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_requests_idem_idx" ON "ai_log_requests" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "lots_variant_idx" ON "inventory_lots" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "movements_lot_idx" ON "inventory_movements" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "movements_variant_idx" ON "inventory_movements" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lot_owner_idx" ON "lot_ownership_allocations" USING btree ("lot_id","partner_id");--> statement-breakpoint
CREATE INDEX "profit_alloc_partner_idx" ON "lot_profit_allocations" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "profit_alloc_sale_idx" ON "lot_profit_allocations" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "product_images_product_idx" ON "product_images" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_product_size_idx" ON "product_variants" USING btree ("product_id","size");--> statement-breakpoint
CREATE INDEX "products_match_idx" ON "products" USING btree ("match_key");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "products_brand_idx" ON "products" USING btree ("brand");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_idem_idx" ON "purchase_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_idem_idx" ON "refunds" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "review_status_idx" ON "review_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sale_items_sale_idx" ON "sale_items" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_items_lot_idx" ON "sale_items" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_idem_idx" ON "sales" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "sales_date_idx" ON "sales" USING btree ("sale_date");--> statement-breakpoint
CREATE INDEX "sales_customer_idx" ON "sales" USING btree ("customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");