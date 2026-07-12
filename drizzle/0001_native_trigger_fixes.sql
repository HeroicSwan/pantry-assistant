CREATE OR REPLACE FUNCTION validate_membership_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  membership_org uuid;
  membership_state membership_status;
  selected_scope role_scope;
  selected_role_org uuid;
  selected_role_slug text;
  location_org uuid;
BEGIN
  IF NEW.archived_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT organization_id, status INTO membership_org, membership_state FROM organization_memberships WHERE id = NEW.organization_membership_id;
  SELECT scope, organization_id, slug INTO selected_scope, selected_role_org, selected_role_slug FROM roles WHERE id = NEW.role_id AND archived_at IS NULL;
  IF membership_org IS NULL OR membership_state <> 'active' OR selected_scope IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'INVALID_ROLE_ASSIGNMENT';
  END IF;
  IF selected_role_org IS NOT NULL AND selected_role_org <> membership_org THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'CROSS_ORGANIZATION_ROLE';
  END IF;
  IF selected_scope = 'organization' AND NEW.location_id IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ORGANIZATION_ROLE_HAS_LOCATION';
  END IF;
  IF selected_scope = 'location' AND NEW.location_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LOCATION_ROLE_REQUIRES_LOCATION';
  END IF;
  IF selected_role_slug = 'administrator' AND NEW.expires_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'ADMINISTRATOR_CANNOT_EXPIRE';
  END IF;
  IF selected_scope = 'location' THEN
    SELECT organization_id INTO location_org FROM pantry_locations WHERE id = NEW.location_id AND status <> 'archived';
    IF location_org IS NULL OR location_org <> membership_org OR NOT EXISTS (
      SELECT 1 FROM location_memberships
      WHERE organization_membership_id = NEW.organization_membership_id
        AND location_id = NEW.location_id AND status = 'active' AND archived_at IS NULL
    ) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'LOCATION_ASSIGNMENT_REQUIRED';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
