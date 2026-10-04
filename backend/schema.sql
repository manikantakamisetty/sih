-- =======================================================================
-- PostGIS 3D Cadastral & Vertical Strata Schema for Supabase / PostgreSQL
-- Implements ISO 19152 LADM (Land Administration Domain Model)
-- =======================================================================

-- 1. Enable PostGIS extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Enumerated Types
CREATE TYPE cadastre_workflow_status AS ENUM (
    'Draft',
    'Pending_Town_Planner',
    'Pending_SRO',
    'Approved',
    'Rejected_By_Planner',
    'Rejected_By_SRO'
);

CREATE TYPE spatial_data_quality_enum AS ENUM (
    'Survey_Grade',
    'Parametric_Fallback',
    'Preliminary_Estimated'
);

CREATE TYPE unit_classification_enum AS ENUM (
    'Residential',
    'Commercial',
    'Parking',
    'Utility',
    'Common_Area'
);

-- 3. 2D Land Parcel Table
CREATE TABLE IF NOT EXISTS cadastral_parcels_2d (
    parcel_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ulpin_2d VARCHAR(32) UNIQUE NOT NULL,
    survey_number VARCHAR(64) NOT NULL,
    plot_number VARCHAR(64),
    district VARCHAR(64) NOT NULL,
    state VARCHAR(64) NOT NULL,
    pin_code VARCHAR(10),
    centroid_geom GEOMETRY(Point, 4326),
    boundary_geom GEOMETRY(Polygon, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 3D Building Volume Table
CREATE TABLE IF NOT EXISTS building_structures_3d (
    building_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    parcel_id UUID REFERENCES cadastral_parcels_2d(parcel_id) ON DELETE CASCADE,
    building_code VARCHAR(32) NOT NULL, -- e.g. B001
    building_name VARCHAR(128) NOT NULL,
    total_floors INTEGER NOT NULL CHECK (total_floors > 0),
    flats_per_floor INTEGER NOT NULL CHECK (flats_per_floor > 0),
    building_length_m NUMERIC(8,2) NOT NULL,
    building_width_m NUMERIC(8,2) NOT NULL,
    building_height_m NUMERIC(8,2) NOT NULL,
    floor_height_m NUMERIC(8,2) DEFAULT 3.0,
    spatial_quality spatial_data_quality_enum DEFAULT 'Survey_Grade',
    status cadastre_workflow_status DEFAULT 'Draft',
    -- 3D Volumetric Extrusion / Polyhedral Surface
    footprint_3d_geom GEOMETRY(PolygonZ, 4326),
    solid_envelope_3d GEOMETRY(PolyhedralSurfaceZ, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Vertical Strata Units Table (Individual 3D Flat ULPINs)
CREATE TABLE IF NOT EXISTS vertical_strata_units_3d (
    unit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID REFERENCES building_structures_3d(building_id) ON DELETE CASCADE,
    ulpin_3d VARCHAR(64) UNIQUE NOT NULL, -- 2D_ULPIN-B01-F002-U202
    flat_code VARCHAR(32) NOT NULL,       -- e.g. Flat 202
    floor_number INTEGER NOT NULL,        -- 0 for Ground, 1 for Floor 1...
    unit_type unit_classification_enum DEFAULT 'Residential',
    elevation_bottom_m NUMERIC(8,2) NOT NULL,
    elevation_top_m NUMERIC(8,2) NOT NULL,
    area_sqm NUMERIC(8,2) NOT NULL,
    color_hex VARCHAR(10) DEFAULT '#4ECDC4',
    owner_name VARCHAR(255) DEFAULT 'Allotted Holder',
    owner_share_pct NUMERIC(5,2) DEFAULT 100.0,
    deed_reference VARCHAR(64),
    is_planner_accepted BOOLEAN DEFAULT TRUE,
    is_sro_accepted BOOLEAN DEFAULT TRUE,
    -- 3D Bounding Polyhedron for Unit Space
    unit_polyhedron_3d GEOMETRY(PolyhedralSurfaceZ, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Rejection & Audit Log Table (Full State Rollback History)
CREATE TABLE IF NOT EXISTS cadastre_audit_history (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID REFERENCES building_structures_3d(building_id) ON DELETE CASCADE,
    author_role VARCHAR(32) NOT NULL,
    author_name VARCHAR(128) NOT NULL,
    status_change VARCHAR(128) NOT NULL,
    remarks TEXT NOT NULL,
    affected_components JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Spatial Indexes for High-Performance Queries
CREATE INDEX IF NOT EXISTS idx_parcel_centroid ON cadastral_parcels_2d USING GIST(centroid_geom);
CREATE INDEX IF NOT EXISTS idx_building_footprint_3d ON building_structures_3d USING GIST(footprint_3d_geom);
CREATE INDEX IF NOT EXISTS idx_strata_polyhedron ON vertical_strata_units_3d USING GIST(unit_polyhedron_3d);
CREATE INDEX IF NOT EXISTS idx_ulpin_3d ON vertical_strata_units_3d(ulpin_3d);

-- 8. Trigger to Automatically Update updated_at timestamps
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_parcels_update
    BEFORE UPDATE ON cadastral_parcels_2d
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_building_update
    BEFORE UPDATE ON building_structures_3d
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_strata_update
    BEFORE UPDATE ON vertical_strata_units_3d
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();
