-- Double-booking protection that Drizzle cannot express.
--
-- vehicle_occupancy holds one row per active reservation (PENDING, CONFIRMED, PICKED_UP) and one row
-- per maintenance block. Triggers keep it in step with reservations and maintenance_blocks, and its
-- exclusion constraint guarantees that, per vehicle, no two of these periods overlap. Periods are
-- '[)' ranges, so a rental ending at 10:00 and the next starting at 10:00 do not overlap.
-- A violation raises SQLSTATE 23P01 (exclusion_violation).
-- There is deliberately no second exclusion constraint on reservations itself: two guards over the same
-- rows take index locks in opposite orders and turn concurrent losers into deadlocks (40P01).

ALTER TABLE "vehicle_occupancy" ADD CONSTRAINT "vehicle_occupancy_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&);
--> statement-breakpoint
ALTER TABLE "maintenance_blocks" ADD CONSTRAINT "maintenance_blocks_no_overlap"
  EXCLUDE USING gist ("vehicle_id" WITH =, "period" WITH &&);
--> statement-breakpoint
CREATE INDEX "vehicle_occupancy_period_idx" ON "vehicle_occupancy" USING gist ("period");
--> statement-breakpoint
CREATE FUNCTION "sync_reservation_occupancy"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('PENDING', 'CONFIRMED', 'PICKED_UP') THEN
    INSERT INTO vehicle_occupancy (vehicle_id, kind, reservation_id, period)
    VALUES (NEW.vehicle_id, 'RESERVATION', NEW.id, NEW.period)
    ON CONFLICT (reservation_id) DO UPDATE
      SET vehicle_id = EXCLUDED.vehicle_id, period = EXCLUDED.period;
  ELSE
    DELETE FROM vehicle_occupancy WHERE reservation_id = NEW.id;
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "reservations_sync_occupancy"
  AFTER INSERT OR UPDATE OF "status", "vehicle_id", "pickup_at", "return_at" ON "reservations"
  FOR EACH ROW EXECUTE FUNCTION "sync_reservation_occupancy"();
--> statement-breakpoint
CREATE FUNCTION "sync_maintenance_occupancy"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO vehicle_occupancy (vehicle_id, kind, maintenance_block_id, period)
  VALUES (NEW.vehicle_id, 'MAINTENANCE', NEW.id, NEW.period)
  ON CONFLICT (maintenance_block_id) DO UPDATE
    SET vehicle_id = EXCLUDED.vehicle_id, period = EXCLUDED.period;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "maintenance_blocks_sync_occupancy"
  AFTER INSERT OR UPDATE OF "vehicle_id", "starts_at", "ends_at" ON "maintenance_blocks"
  FOR EACH ROW EXECUTE FUNCTION "sync_maintenance_occupancy"();
