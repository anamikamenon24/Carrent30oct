CREATE TYPE "public"."damage_severity" AS ENUM('MINOR', 'MODERATE', 'MAJOR');--> statement-breakpoint
CREATE TYPE "public"."damage_stage" AS ENUM('PICKUP', 'RETURN', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."damage_status" AS ENUM('OPEN', 'CHARGED', 'WAIVED', 'REPAIRED');--> statement-breakpoint
CREATE TYPE "public"."deposit_status" AS ENUM('PENDING', 'HELD', 'FAILED', 'RELEASED', 'PARTIALLY_CAPTURED', 'CAPTURED');--> statement-breakpoint
CREATE TYPE "public"."extra_pricing" AS ENUM('PER_DAY', 'PER_RENTAL');--> statement-breakpoint
CREATE TYPE "public"."fuel_type" AS ENUM('PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC');--> statement-breakpoint
CREATE TYPE "public"."occupancy_kind" AS ENUM('RESERVATION', 'MAINTENANCE');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('RENTAL', 'MODIFICATION', 'RETURN_CHARGES');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."pricing_rule_type" AS ENUM('SEASONAL', 'DURATION_DISCOUNT', 'ONE_WAY_FEE');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('PENDING', 'CONFIRMED', 'PICKED_UP', 'RETURNED', 'CANCELLED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."transmission" AS ENUM('AUTOMATIC', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('CUSTOMER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."vehicle_status" AS ENUM('AVAILABLE', 'RESERVED', 'ON_RENT', 'MAINTENANCE', 'RETIRED');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"emirate" text NOT NULL,
	"address_line" text NOT NULL,
	"phone" text,
	"email" text,
	"time_zone" text DEFAULT 'Asia/Dubai' NOT NULL,
	"latitude" numeric(9, 6),
	"longitude" numeric(9, 6),
	"opens_at" time DEFAULT '08:00' NOT NULL,
	"closes_at" time DEFAULT '22:00' NOT NULL,
	"is_24_hours" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branches_code_unique" UNIQUE("code"),
	CONSTRAINT "branches_code_format" CHECK ("branches"."code" ~ '^[A-Z0-9-]{2,16}$'),
	CONSTRAINT "branches_hours_check" CHECK ("branches"."is_24_hours" or "branches"."opens_at" < "branches"."closes_at"),
	CONSTRAINT "branches_lat_check" CHECK ("branches"."latitude" is null or "branches"."latitude" between -90 and 90),
	CONSTRAINT "branches_lng_check" CHECK ("branches"."longitude" is null or "branches"."longitude" between -180 and 180)
);
--> statement-breakpoint
CREATE TABLE "damage_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"reservation_id" uuid,
	"rental_agreement_id" uuid,
	"reported_by" uuid,
	"stage" "damage_stage" NOT NULL,
	"severity" "damage_severity" NOT NULL,
	"status" "damage_status" DEFAULT 'OPEN' NOT NULL,
	"location" text,
	"description" text NOT NULL,
	"photo_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"estimated_cost_fils" integer,
	"charge_fils" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "damage_reports_description_check" CHECK (length(trim("damage_reports"."description")) > 0),
	CONSTRAINT "damage_reports_money_check" CHECK (coalesce("damage_reports"."estimated_cost_fils", 0) >= 0 and "damage_reports"."charge_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "deposits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"status" "deposit_status" DEFAULT 'PENDING' NOT NULL,
	"amount_fils" integer NOT NULL,
	"captured_fils" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"provider" text NOT NULL,
	"provider_hold_id" text,
	"idempotency_key" text NOT NULL,
	"failure_reason" text,
	"held_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deposits_provider_hold_id_unique" UNIQUE("provider_hold_id"),
	CONSTRAINT "deposits_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "deposits_amount_check" CHECK ("deposits"."amount_fils" > 0 and "deposits"."captured_fils" between 0 and "deposits"."amount_fils"),
	CONSTRAINT "deposits_currency_check" CHECK ("deposits"."currency" = 'AED')
);
--> statement-breakpoint
CREATE TABLE "driver_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"phone" text NOT NULL,
	"nationality" text,
	"address_line" text,
	"city" text,
	"country" text,
	"licence_number" text NOT NULL,
	"licence_country" text NOT NULL,
	"licence_issued_on" date,
	"licence_expires_on" date NOT NULL,
	"licence_file_key" text,
	"licence_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "driver_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "driver_profiles_names_check" CHECK (length(trim("driver_profiles"."first_name")) > 0 and length(trim("driver_profiles"."last_name")) > 0),
	CONSTRAINT "driver_profiles_licence_dates_check" CHECK ("driver_profiles"."licence_issued_on" is null or "driver_profiles"."licence_issued_on" < "driver_profiles"."licence_expires_on"),
	CONSTRAINT "driver_profiles_dob_check" CHECK ("driver_profiles"."date_of_birth" > date '1900-01-01')
);
--> statement-breakpoint
CREATE TABLE "extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"pricing" "extra_pricing" NOT NULL,
	"price_fils" integer NOT NULL,
	"max_quantity" smallint DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extras_code_unique" UNIQUE("code"),
	CONSTRAINT "extras_price_check" CHECK ("extras"."price_fils" >= 0),
	CONSTRAINT "extras_max_quantity_check" CHECK ("extras"."max_quantity" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "maintenance_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"period" "tstzrange" GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_blocks_period_check" CHECK ("maintenance_blocks"."ends_at" > "maintenance_blocks"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"kind" "payment_kind" DEFAULT 'RENTAL' NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"amount_fils" integer NOT NULL,
	"refunded_fils" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"provider" text NOT NULL,
	"provider_charge_id" text,
	"idempotency_key" text NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_provider_charge_id_unique" UNIQUE("provider_charge_id"),
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_fils" > 0 and "payments"."refunded_fils" between 0 and "payments"."amount_fils"),
	CONSTRAINT "payments_currency_check" CHECK ("payments"."currency" = 'AED')
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"type" "pricing_rule_type" NOT NULL,
	"category_id" uuid,
	"pickup_branch_id" uuid,
	"return_branch_id" uuid,
	"valid_from" date,
	"valid_to" date,
	"min_days" integer,
	"adjustment_bps" integer,
	"amount_fils" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_dates_check" CHECK ("pricing_rules"."valid_from" is null or "pricing_rules"."valid_to" is null or "pricing_rules"."valid_from" <= "pricing_rules"."valid_to"),
	CONSTRAINT "pricing_rules_shape_check" CHECK (case "pricing_rules"."type"
        when 'SEASONAL' then "pricing_rules"."adjustment_bps" is not null and "pricing_rules"."adjustment_bps" between -9000 and 30000
          and "pricing_rules"."valid_from" is not null and "pricing_rules"."valid_to" is not null
        when 'DURATION_DISCOUNT' then "pricing_rules"."adjustment_bps" is not null and "pricing_rules"."adjustment_bps" between -9000 and 0
          and "pricing_rules"."min_days" is not null and "pricing_rules"."min_days" >= 2
        when 'ONE_WAY_FEE' then "pricing_rules"."amount_fils" is not null and "pricing_rules"."amount_fils" >= 0
          and ("pricing_rules"."pickup_branch_id" is null or "pricing_rules"."return_branch_id" is null or "pricing_rules"."pickup_branch_id" <> "pricing_rules"."return_branch_id")
      end)
);
--> statement-breakpoint
CREATE TABLE "rental_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"agreement_number" text NOT NULL,
	"checked_out_by" uuid,
	"checked_out_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pickup_mileage_km" integer NOT NULL,
	"pickup_fuel_eighths" smallint NOT NULL,
	"pickup_notes" text,
	"checked_in_by" uuid,
	"returned_at" timestamp with time zone,
	"return_branch_id" uuid,
	"return_mileage_km" integer,
	"return_fuel_eighths" smallint,
	"return_notes" text,
	"late_minutes" integer,
	"late_fee_fils" integer,
	"fuel_charge_fils" integer,
	"damage_charge_fils" integer,
	"return_vat_fils" integer,
	"return_charges_fils" integer,
	"outstanding_fils" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rental_agreements_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "rental_agreements_agreement_number_unique" UNIQUE("agreement_number"),
	CONSTRAINT "rental_agreements_pickup_check" CHECK ("rental_agreements"."pickup_mileage_km" >= 0 and "rental_agreements"."pickup_fuel_eighths" between 0 and 8),
	CONSTRAINT "rental_agreements_return_check" CHECK (("rental_agreements"."returned_at" is null and "rental_agreements"."return_mileage_km" is null and "rental_agreements"."return_fuel_eighths" is null)
        or ("rental_agreements"."returned_at" is not null and "rental_agreements"."return_mileage_km" >= "rental_agreements"."pickup_mileage_km"
            and "rental_agreements"."return_fuel_eighths" between 0 and 8 and "rental_agreements"."returned_at" >= "rental_agreements"."checked_out_at")),
	CONSTRAINT "rental_agreements_charges_check" CHECK (coalesce("rental_agreements"."late_minutes", 0) >= 0 and coalesce("rental_agreements"."late_fee_fils", 0) >= 0 and coalesce("rental_agreements"."fuel_charge_fils", 0) >= 0
        and coalesce("rental_agreements"."damage_charge_fils", 0) >= 0 and coalesce("rental_agreements"."return_vat_fils", 0) >= 0
        and coalesce("rental_agreements"."return_charges_fils", 0) >= 0 and coalesce("rental_agreements"."outstanding_fils", 0) >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservation_extras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"extra_id" uuid NOT NULL,
	"quantity" smallint NOT NULL,
	"pricing" "extra_pricing" NOT NULL,
	"unit_price_fils" integer NOT NULL,
	"total_fils" integer NOT NULL,
	CONSTRAINT "reservation_extras_quantity_check" CHECK ("reservation_extras"."quantity" between 1 and 10),
	CONSTRAINT "reservation_extras_money_check" CHECK ("reservation_extras"."unit_price_fils" >= 0 and "reservation_extras"."total_fils" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"user_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"pickup_branch_id" uuid NOT NULL,
	"return_branch_id" uuid NOT NULL,
	"driver_profile_id" uuid,
	"pickup_at" timestamp with time zone NOT NULL,
	"return_at" timestamp with time zone NOT NULL,
	"period" "tstzrange" GENERATED ALWAYS AS (tstzrange(pickup_at, return_at, '[)')) STORED NOT NULL,
	"status" "reservation_status" DEFAULT 'PENDING' NOT NULL,
	"hold_expires_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"rental_days" integer NOT NULL,
	"daily_rate_fils" integer NOT NULL,
	"rental_fils" integer NOT NULL,
	"discount_fils" integer DEFAULT 0 NOT NULL,
	"extras_fils" integer DEFAULT 0 NOT NULL,
	"one_way_fee_fils" integer DEFAULT 0 NOT NULL,
	"subtotal_fils" integer NOT NULL,
	"vat_bps" integer NOT NULL,
	"vat_fils" integer NOT NULL,
	"total_fils" integer NOT NULL,
	"deposit_fils" integer NOT NULL,
	"price_breakdown" jsonb NOT NULL,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"cancellation_fee_fils" integer,
	"refunded_fils" integer DEFAULT 0 NOT NULL,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservations_reference_unique" UNIQUE("reference"),
	CONSTRAINT "reservations_period_check" CHECK ("reservations"."return_at" > "reservations"."pickup_at"),
	CONSTRAINT "reservations_currency_check" CHECK ("reservations"."currency" = 'AED'),
	CONSTRAINT "reservations_hold_check" CHECK ("reservations"."status" <> 'PENDING' or "reservations"."hold_expires_at" is not null),
	CONSTRAINT "reservations_money_check" CHECK ("reservations"."rental_days" >= 1 and "reservations"."daily_rate_fils" > 0 and "reservations"."rental_fils" >= 0 and "reservations"."discount_fils" >= 0
        and "reservations"."extras_fils" >= 0 and "reservations"."one_way_fee_fils" >= 0 and "reservations"."vat_bps" >= 0 and "reservations"."vat_fils" >= 0
        and "reservations"."deposit_fils" >= 0 and "reservations"."refunded_fils" >= 0
        and "reservations"."subtotal_fils" = "reservations"."rental_fils" - "reservations"."discount_fils" + "reservations"."extras_fils" + "reservations"."one_way_fee_fils"
        and "reservations"."total_fils" = "reservations"."subtotal_fils" + "reservations"."vat_fils"
        and "reservations"."refunded_fils" <= "reservations"."total_fils"),
	CONSTRAINT "reservations_cancel_check" CHECK (("reservations"."status" in ('CANCELLED', 'REFUNDED')) = ("reservations"."cancelled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'CUSTOMER' NOT NULL,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"daily_rate_fils" integer NOT NULL,
	"deposit_fils" integer NOT NULL,
	"min_driver_age" smallint DEFAULT 21 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_categories_code_unique" UNIQUE("code"),
	CONSTRAINT "vehicle_categories_rate_check" CHECK ("vehicle_categories"."daily_rate_fils" > 0),
	CONSTRAINT "vehicle_categories_deposit_check" CHECK ("vehicle_categories"."deposit_fils" >= 0),
	CONSTRAINT "vehicle_categories_age_check" CHECK ("vehicle_categories"."min_driver_age" between 18 and 99)
);
--> statement-breakpoint
CREATE TABLE "vehicle_feature_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"feature_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"icon" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_features_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "vehicle_occupancy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" "occupancy_kind" NOT NULL,
	"reservation_id" uuid,
	"maintenance_block_id" uuid,
	"period" "tstzrange" NOT NULL,
	CONSTRAINT "vehicle_occupancy_reservation_id_unique" UNIQUE("reservation_id"),
	CONSTRAINT "vehicle_occupancy_maintenance_block_id_unique" UNIQUE("maintenance_block_id"),
	CONSTRAINT "vehicle_occupancy_source_check" CHECK (("vehicle_occupancy"."kind" = 'RESERVATION' and "vehicle_occupancy"."reservation_id" is not null and "vehicle_occupancy"."maintenance_block_id" is null)
        or ("vehicle_occupancy"."kind" = 'MAINTENANCE' and "vehicle_occupancy"."maintenance_block_id" is not null and "vehicle_occupancy"."reservation_id" is null)),
	CONSTRAINT "vehicle_occupancy_period_check" CHECK (not isempty("vehicle_occupancy"."period") and lower_inc("vehicle_occupancy"."period") and not upper_inc("vehicle_occupancy"."period"))
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"plate_number" text NOT NULL,
	"vin" text NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"year" smallint NOT NULL,
	"color" text,
	"transmission" "transmission" NOT NULL,
	"fuel_type" "fuel_type" NOT NULL,
	"seats" smallint NOT NULL,
	"doors" smallint DEFAULT 4 NOT NULL,
	"luggage" smallint DEFAULT 2 NOT NULL,
	"mileage_km" integer DEFAULT 0 NOT NULL,
	"daily_rate_fils" integer,
	"status" "vehicle_status" DEFAULT 'AVAILABLE' NOT NULL,
	"photos" text[] DEFAULT '{}'::text[] NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_vin_format" CHECK ("vehicles"."vin" ~ '^[A-HJ-NPR-Z0-9]{17}$'),
	CONSTRAINT "vehicles_year_check" CHECK ("vehicles"."year" between 1990 and 2100),
	CONSTRAINT "vehicles_seats_check" CHECK ("vehicles"."seats" between 1 and 15),
	CONSTRAINT "vehicles_doors_check" CHECK ("vehicles"."doors" between 2 and 6),
	CONSTRAINT "vehicles_luggage_check" CHECK ("vehicles"."luggage" between 0 and 12),
	CONSTRAINT "vehicles_mileage_check" CHECK ("vehicles"."mileage_km" >= 0),
	CONSTRAINT "vehicles_rate_check" CHECK ("vehicles"."daily_rate_fils" is null or "vehicles"."daily_rate_fils" > 0)
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_rental_agreement_id_rental_agreements_id_fk" FOREIGN KEY ("rental_agreement_id") REFERENCES "public"."rental_agreements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "damage_reports" ADD CONSTRAINT "damage_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_checked_out_by_users_id_fk" FOREIGN KEY ("checked_out_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_checked_in_by_users_id_fk" FOREIGN KEY ("checked_in_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rental_agreements" ADD CONSTRAINT "rental_agreements_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_extras" ADD CONSTRAINT "reservation_extras_extra_id_extras_id_fk" FOREIGN KEY ("extra_id") REFERENCES "public"."extras"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_pickup_branch_id_branches_id_fk" FOREIGN KEY ("pickup_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_return_branch_id_branches_id_fk" FOREIGN KEY ("return_branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_driver_profile_id_driver_profiles_id_fk" FOREIGN KEY ("driver_profile_id") REFERENCES "public"."driver_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_feature_map" ADD CONSTRAINT "vehicle_feature_map_feature_id_vehicle_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "public"."vehicle_features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_occupancy" ADD CONSTRAINT "vehicle_occupancy_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_occupancy" ADD CONSTRAINT "vehicle_occupancy_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_occupancy" ADD CONSTRAINT "vehicle_occupancy_maintenance_block_id_maintenance_blocks_id_fk" FOREIGN KEY ("maintenance_block_id") REFERENCES "public"."maintenance_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_category_id_vehicle_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."vehicle_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_unique" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "damage_reports_vehicle_idx" ON "damage_reports" USING btree ("vehicle_id","created_at");--> statement-breakpoint
CREATE INDEX "damage_reports_reservation_idx" ON "damage_reports" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "deposits_reservation_idx" ON "deposits" USING btree ("reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deposits_one_live_per_reservation" ON "deposits" USING btree ("reservation_id") WHERE "deposits"."status" in ('PENDING', 'HELD');--> statement-breakpoint
CREATE INDEX "maintenance_blocks_vehicle_idx" ON "maintenance_blocks" USING btree ("vehicle_id","starts_at");--> statement-breakpoint
CREATE INDEX "payments_reservation_idx" ON "payments" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "pricing_rules_type_idx" ON "pricing_rules" USING btree ("type","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_extras_unique" ON "reservation_extras" USING btree ("reservation_id","extra_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_user_idempotency_unique" ON "reservations" USING btree ("user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "reservations_user_idx" ON "reservations" USING btree ("user_id","pickup_at");--> statement-breakpoint
CREATE INDEX "reservations_vehicle_idx" ON "reservations" USING btree ("vehicle_id","pickup_at");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status","pickup_at");--> statement-breakpoint
CREATE INDEX "reservations_pending_hold_idx" ON "reservations" USING btree ("hold_expires_at") WHERE "reservations"."status" = 'PENDING';--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_feature_map_unique" ON "vehicle_feature_map" USING btree ("vehicle_id","feature_id");--> statement-breakpoint
CREATE INDEX "vehicle_feature_map_feature_idx" ON "vehicle_feature_map" USING btree ("feature_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_plate_number_unique" ON "vehicles" USING btree (upper("plate_number"));--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_vin_unique" ON "vehicles" USING btree (upper("vin"));--> statement-breakpoint
CREATE INDEX "vehicles_branch_status_idx" ON "vehicles" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "vehicles_category_idx" ON "vehicles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_unique" ON "webhook_events" USING btree ("provider","event_id");