-- Prompt 3: inventory ledger foundation (rules and derived read models)
-- Reuses set_updated_at() from 0000. All physical quantity lives in the append-only ledger.

CREATE TRIGGER units_of_measure_set_updated_at BEFORE UPDATE ON "units_of_measure" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER inventory_categories_set_updated_at BEFORE UPDATE ON "inventory_categories" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER inventory_items_set_updated_at BEFORE UPDATE ON "inventory_items" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER inventory_item_units_set_updated_at BEFORE UPDATE ON "inventory_item_units" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER storage_locations_set_updated_at BEFORE UPDATE ON "storage_locations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER inventory_lots_set_updated_at BEFORE UPDATE ON "inventory_lots" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Item unit conversions must share the base unit's dimension.
CREATE OR REPLACE FUNCTION validate_inventory_item_unit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE base_dimension unit_dimension; unit_dimension_value unit_dimension;
BEGIN
  SELECT u.dimension INTO base_dimension FROM inventory_items i JOIN units_of_measure u ON u.id = i.base_unit_id WHERE i.id = NEW.inventory_item_id;
  SELECT dimension INTO unit_dimension_value FROM units_of_measure WHERE id = NEW.unit_id;
  IF base_dimension IS NULL OR unit_dimension_value IS NULL OR base_dimension <> unit_dimension_value THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'UNIT_DIMENSION_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_item_units_validate_dimension BEFORE INSERT OR UPDATE OF inventory_item_id, unit_id ON inventory_item_units FOR EACH ROW EXECUTE FUNCTION validate_inventory_item_unit();

-- The ledger is append-only. Direct update or delete is denied at the database boundary.
CREATE OR REPLACE FUNCTION prevent_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'LEDGER_IMMUTABLE';
END;
$$;
CREATE TRIGGER inventory_transactions_immutable BEFORE UPDATE OR DELETE ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();

-- Sign, reversal exactness, archived-lot, and negative-stock protection. Locks the lot row so
-- concurrent posts to one lot are serialized and the on-hand sum cannot race below zero.
CREATE OR REPLACE FUNCTION validate_inventory_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_lot_status lot_status;
  is_positive boolean;
  original inventory_transactions%ROWTYPE;
  resulting_on_hand numeric(20,6);
BEGIN
  SELECT status INTO current_lot_status FROM inventory_lots WHERE id = NEW.inventory_lot_id FOR UPDATE;
  IF current_lot_status = 'archived' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LOT_ARCHIVED';
  END IF;

  IF NEW.transaction_type = 'reversal' THEN
    SELECT * INTO original FROM inventory_transactions WHERE id = NEW.reverses_transaction_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'REVERSAL_TARGET_NOT_FOUND';
    END IF;
    IF original.transaction_type = 'reversal' THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CANNOT_REVERSE_REVERSAL';
    END IF;
    IF original.inventory_lot_id <> NEW.inventory_lot_id
       OR original.inventory_item_id <> NEW.inventory_item_id
       OR original.pantry_location_id <> NEW.pantry_location_id
       OR original.organization_id <> NEW.organization_id THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'REVERSAL_SCOPE_MISMATCH';
    END IF;
    IF NEW.physical_delta <> -original.physical_delta THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'REVERSAL_DELTA_MISMATCH';
    END IF;
  ELSE
    is_positive := NEW.transaction_type IN ('opening_balance','donation_received','purchase_received','transfer_in','manual_positive_adjustment');
    IF is_positive AND NEW.physical_delta <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TRANSACTION_SIGN_INVALID';
    END IF;
    IF (NOT is_positive) AND NEW.physical_delta >= 0 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'TRANSACTION_SIGN_INVALID';
    END IF;
  END IF;

  SELECT COALESCE(SUM(physical_delta), 0) + NEW.physical_delta INTO resulting_on_hand
    FROM inventory_transactions WHERE inventory_lot_id = NEW.inventory_lot_id;
  IF resulting_on_hand < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INSUFFICIENT_STOCK';
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_transactions_validate BEFORE INSERT ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION validate_inventory_transaction();

-- Lot status is derived from physical on-hand: depleted at zero, active while positive. Never reactivates an archived lot.
CREATE OR REPLACE FUNCTION sync_lot_status_after_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE on_hand numeric(20,6); target lot_status;
BEGIN
  SELECT COALESCE(SUM(physical_delta), 0) INTO on_hand FROM inventory_transactions WHERE inventory_lot_id = NEW.inventory_lot_id;
  target := CASE WHEN on_hand <= 0 THEN 'depleted'::lot_status ELSE 'active'::lot_status END;
  UPDATE inventory_lots SET status = target
    WHERE id = NEW.inventory_lot_id AND status <> 'archived' AND status <> target;
  RETURN NEW;
END;
$$;
CREATE TRIGGER inventory_transactions_sync_lot AFTER INSERT ON inventory_transactions FOR EACH ROW EXECUTE FUNCTION sync_lot_status_after_transaction();

-- Derived lot balances. Expiration is evaluated against the pantry location's local date.
-- available == valid_on_hand for Prompt 3; reservations, quarantine, and recall subtract in later prompts.
CREATE VIEW inventory_lot_balances AS
SELECT
  l.id AS inventory_lot_id,
  l.organization_id,
  l.pantry_location_id,
  l.inventory_item_id,
  l.storage_location_id,
  l.status AS lot_status,
  l.lot_code,
  l.received_date,
  l.expiration_date,
  COALESCE(t.physical_on_hand, 0) AS physical_on_hand,
  (l.expiration_date IS NOT NULL AND l.expiration_date < (now() AT TIME ZONE COALESCE(pl.timezone, o.timezone))::date) AS is_expired,
  CASE
    WHEN l.expiration_date IS NOT NULL AND l.expiration_date < (now() AT TIME ZONE COALESCE(pl.timezone, o.timezone))::date
    THEN COALESCE(t.physical_on_hand, 0) ELSE 0
  END AS expired_quantity,
  CASE
    WHEN l.status = 'active'
      AND NOT (l.expiration_date IS NOT NULL AND l.expiration_date < (now() AT TIME ZONE COALESCE(pl.timezone, o.timezone))::date)
    THEN COALESCE(t.physical_on_hand, 0) ELSE 0
  END AS valid_on_hand,
  CASE
    WHEN l.status = 'active'
      AND NOT (l.expiration_date IS NOT NULL AND l.expiration_date < (now() AT TIME ZONE COALESCE(pl.timezone, o.timezone))::date)
    THEN COALESCE(t.physical_on_hand, 0) ELSE 0
  END AS available_quantity
FROM inventory_lots l
JOIN pantry_locations pl ON pl.id = l.pantry_location_id
JOIN organizations o ON o.id = l.organization_id
LEFT JOIN (
  SELECT inventory_lot_id, SUM(physical_delta) AS physical_on_hand
  FROM inventory_transactions
  GROUP BY inventory_lot_id
) t ON t.inventory_lot_id = l.id;

-- Item-per-location rollups.
CREATE VIEW inventory_item_location_balances AS
SELECT
  organization_id,
  pantry_location_id,
  inventory_item_id,
  SUM(physical_on_hand) AS physical_on_hand,
  SUM(expired_quantity) AS expired_quantity,
  SUM(valid_on_hand) AS valid_on_hand,
  SUM(available_quantity) AS available_quantity
FROM inventory_lot_balances
GROUP BY organization_id, pantry_location_id, inventory_item_id;
