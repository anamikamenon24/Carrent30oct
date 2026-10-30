CREATE TABLE "rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "reservations" DROP CONSTRAINT "reservations_money_check";--> statement-breakpoint
CREATE INDEX "damage_reports_agreement_idx" ON "damage_reports" USING btree ("rental_agreement_id");--> statement-breakpoint
CREATE INDEX "damage_reports_reported_by_idx" ON "damage_reports" USING btree ("reported_by");--> statement-breakpoint
CREATE INDEX "maintenance_blocks_created_by_idx" ON "maintenance_blocks" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX "pricing_rules_category_idx" ON "pricing_rules" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "pricing_rules_pickup_branch_idx" ON "pricing_rules" USING btree ("pickup_branch_id");--> statement-breakpoint
CREATE INDEX "pricing_rules_return_branch_idx" ON "pricing_rules" USING btree ("return_branch_id");--> statement-breakpoint
CREATE INDEX "rental_agreements_return_branch_idx" ON "rental_agreements" USING btree ("return_branch_id");--> statement-breakpoint
CREATE INDEX "rental_agreements_checked_out_by_idx" ON "rental_agreements" USING btree ("checked_out_by");--> statement-breakpoint
CREATE INDEX "rental_agreements_checked_in_by_idx" ON "rental_agreements" USING btree ("checked_in_by");--> statement-breakpoint
CREATE INDEX "reservation_extras_extra_idx" ON "reservation_extras" USING btree ("extra_id");--> statement-breakpoint
CREATE INDEX "reservations_pickup_branch_idx" ON "reservations" USING btree ("pickup_branch_id");--> statement-breakpoint
CREATE INDEX "reservations_return_branch_idx" ON "reservations" USING btree ("return_branch_id");--> statement-breakpoint
CREATE INDEX "reservations_driver_profile_idx" ON "reservations" USING btree ("driver_profile_id");--> statement-breakpoint
CREATE INDEX "vehicle_occupancy_vehicle_idx" ON "vehicle_occupancy" USING btree ("vehicle_id");--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_money_check" CHECK ("reservations"."rental_days" >= 1 and "reservations"."daily_rate_fils" > 0 and "reservations"."rental_fils" >= 0 and "reservations"."discount_fils" >= 0
        and "reservations"."extras_fils" >= 0 and "reservations"."one_way_fee_fils" >= 0 and "reservations"."vat_bps" >= 0 and "reservations"."vat_fils" >= 0
        and "reservations"."deposit_fils" >= 0 and "reservations"."refunded_fils" >= 0
        and "reservations"."subtotal_fils" = "reservations"."rental_fils" - "reservations"."discount_fils" + "reservations"."extras_fils" + "reservations"."one_way_fee_fils"
        and "reservations"."total_fils" = "reservations"."subtotal_fils" + "reservations"."vat_fils");