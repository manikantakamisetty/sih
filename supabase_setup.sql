-- =======================================================================
-- Supabase Setup Script: 3D Cadastral & Vertical Strata System (DILRMP)
-- Run this in your Supabase Dashboard -> SQL Editor
-- =======================================================================

-- 1. Enable PostGIS & UUID extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Create Enums
DO $$ BEGIN
    CREATE TYPE cadastre_workflow_status AS ENUM (
        'Draft',
        'Pending_Town_Planner',
        'Pending_SRO',
        'Approved',
        'Rejected_By_Planner',
        'Rejected_By_SRO'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE spatial_data_quality_enum AS ENUM (
        'Survey_Grade',
        'Parametric_Fallback',
        'Preliminary_Estimated'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE unit_classification_enum AS ENUM (
        'Residential',
        'Commercial',
        'Parking',
        'Utility',
        'Common_Area',
        'Penthouse'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. 2D Land Parcel Table
CREATE TABLE IF NOT EXISTS cadastral_parcels_2d (
    parcel_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ulpin_2d VARCHAR(32) UNIQUE NOT NULL,
    survey_number VARCHAR(64) NOT NULL,
    plot_number VARCHAR(64),
    district VARCHAR(64) NOT NULL,
    state VARCHAR(64) NOT NULL DEFAULT 'Telangana',
    pin_code VARCHAR(10) DEFAULT '500081',
    address TEXT,
    latitude NUMERIC(10,6),
    longitude NUMERIC(10,6),
    centroid_geom GEOMETRY(Point, 4326),
    boundary_geom GEOMETRY(Polygon, 4326),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 3D Building Volume Table
CREATE TABLE IF NOT EXISTS building_structures_3d (
    building_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id VARCHAR(64) UNIQUE NOT NULL,
    ulpin_2d VARCHAR(32) REFERENCES cadastral_parcels_2d(ulpin_2d) ON DELETE CASCADE,
    building_code VARCHAR(32) NOT NULL,
    building_name VARCHAR(128) NOT NULL,
    total_floors INTEGER NOT NULL CHECK (total_floors > 0),
    flats_per_floor INTEGER NOT NULL CHECK (flats_per_floor > 0),
    building_length_m NUMERIC(8,2) NOT NULL,
    building_width_m NUMERIC(8,2) NOT NULL,
    building_height_m NUMERIC(8,2) NOT NULL,
    floor_height_m NUMERIC(8,2) DEFAULT 3.0,
    is_identical_flats BOOLEAN DEFAULT TRUE,
    spatial_quality spatial_data_quality_enum DEFAULT 'Survey_Grade',
    status cadastre_workflow_status DEFAULT 'Draft',
    building_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Vertical Strata Units Table (3D Flat ULPINs)
CREATE TABLE IF NOT EXISTS vertical_strata_units_3d (
    unit_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    building_id UUID REFERENCES building_structures_3d(building_id) ON DELETE CASCADE,
    application_id VARCHAR(64) NOT NULL,
    ulpin_3d VARCHAR(64) UNIQUE NOT NULL,
    flat_code VARCHAR(32) NOT NULL,
    floor_number INTEGER NOT NULL,
    unit_type unit_classification_enum DEFAULT 'Residential',
    width_m NUMERIC(8,2) NOT NULL,
    length_m NUMERIC(8,2) NOT NULL,
    height_m NUMERIC(8,2) NOT NULL,
    elevation_bottom_m NUMERIC(8,2) NOT NULL,
    elevation_top_m NUMERIC(8,2) NOT NULL,
    area_sqm NUMERIC(8,2) NOT NULL,
    color_hex VARCHAR(10) DEFAULT '#4ECDC4',
    owner_name VARCHAR(255) DEFAULT 'Allotted Holder',
    owner_share_pct NUMERIC(5,2) DEFAULT 100.0,
    deed_reference VARCHAR(64),
    is_planner_accepted BOOLEAN DEFAULT TRUE,
    is_sro_accepted BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Rejection & Audit Log Table (State Rollback Trail)
CREATE TABLE IF NOT EXISTS cadastre_audit_history (
    log_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    application_id VARCHAR(64) NOT NULL,
    author_role VARCHAR(32) NOT NULL,
    author_name VARCHAR(128) NOT NULL,
    status_change VARCHAR(128) NOT NULL,
    remarks TEXT NOT NULL,
    affected_components JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Spatial & Search Indexes
CREATE INDEX IF NOT EXISTS idx_parcel_ulpin ON cadastral_parcels_2d(ulpin_2d);
CREATE INDEX IF NOT EXISTS idx_bldg_app_id ON building_structures_3d(application_id);
CREATE INDEX IF NOT EXISTS idx_strata_ulpin_3d ON vertical_strata_units_3d(ulpin_3d);
CREATE INDEX IF NOT EXISTS idx_strata_deed_ref ON vertical_strata_units_3d(deed_reference);
CREATE INDEX IF NOT EXISTS idx_audit_app_id ON cadastre_audit_history(application_id);

-- 8. Row Level Security (RLS) Policies (Enable Public API Access)
ALTER TABLE cadastral_parcels_2d ENABLE ROW LEVEL SECURITY;
ALTER TABLE building_structures_3d ENABLE ROW LEVEL SECURITY;
ALTER TABLE vertical_strata_units_3d ENABLE ROW LEVEL SECURITY;
ALTER TABLE cadastre_audit_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read on parcels" ON cadastral_parcels_2d FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update on parcels" ON cadastral_parcels_2d FOR ALL USING (true);

CREATE POLICY "Allow public read on buildings" ON building_structures_3d FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update on buildings" ON building_structures_3d FOR ALL USING (true);

CREATE POLICY "Allow public read on strata units" ON vertical_strata_units_3d FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update on strata units" ON vertical_strata_units_3d FOR ALL USING (true);

CREATE POLICY "Allow public read on audit logs" ON cadastre_audit_history FOR SELECT USING (true);
CREATE POLICY "Allow public insert on audit logs" ON cadastre_audit_history FOR ALL USING (true);

-- =======================================================================
-- 9. Initial Seed Data (Parcels, 3D Building Volumes & Vertical Flats)
-- =======================================================================

-- Parcel B002 (Cyber Stratum Enclave - Awaiting SRO Deed)
INSERT INTO cadastral_parcels_2d (ulpin_2d, survey_number, plot_number, district, state, pin_code, address, latitude, longitude)
VALUES (
    '72541DC5174453',
    'SY-402/1A',
    'Plot 18',
    'Rangareddy',
    'Telangana',
    '500081',
    'Plot 18, Cyber Towers Sector, Madhapur, Rangareddy, Hyderabad, Telangana 500081',
    17.448293,
    78.384210
) ON CONFLICT (ulpin_2d) DO NOTHING;

INSERT INTO building_structures_3d (application_id, ulpin_2d, building_code, building_name, total_floors, flats_per_floor, building_length_m, building_width_m, building_height_m, floor_height_m, status, spatial_quality)
VALUES (
    'APP-TEL-2026-002',
    '72541DC5174453',
    'B002',
    'Cyber Stratum Enclave',
    3,
    2,
    24.0,
    16.0,
    9.0,
    3.0,
    'Pending_SRO',
    'Survey_Grade'
) ON CONFLICT (application_id) DO NOTHING;

-- Seed Vertical Strata Units for B002 (Ground, Floor 1, Floor 2)
INSERT INTO vertical_strata_units_3d (application_id, ulpin_3d, flat_code, floor_number, unit_type, width_m, length_m, height_m, elevation_bottom_m, elevation_top_m, area_sqm, color_hex, owner_name, deed_reference)
VALUES 
    ('APP-TEL-2026-002', '72541DC5174453-B02-F000-U001', 'Parking / Utility 1', 0, 'Parking', 8.0, 24.0, 3.0, 0.0, 3.0, 192.0, '#4ECDC4', 'Apex Infrastructure', 'DOC-2026-TEL-B002-001'),
    ('APP-TEL-2026-002', '72541DC5174453-B02-F000-U002', 'Parking / Utility 2', 0, 'Parking', 8.0, 24.0, 3.0, 0.0, 3.0, 192.0, '#FF6B6B', 'Apex Infrastructure', 'DOC-2026-TEL-B002-002'),
    ('APP-TEL-2026-002', '72541DC5174453-B02-F001-U101', 'Flat 101', 1, 'Residential', 8.0, 24.0, 3.0, 3.0, 6.0, 192.0, '#FFE66D', 'Allotted Holder Unit 101', 'DOC-2026-TEL-B002-101'),
    ('APP-TEL-2026-002', '72541DC5174453-B02-F001-U102', 'Flat 102', 1, 'Residential', 8.0, 24.0, 3.0, 3.0, 6.0, 192.0, '#95E1D3', 'Allotted Holder Unit 102', 'DOC-2026-TEL-B002-102'),
    ('APP-TEL-2026-002', '72541DC5174453-B02-F002-U201', 'Flat 201', 2, 'Residential', 8.0, 24.0, 3.0, 6.0, 9.0, 192.0, '#F38181', 'Allotted Holder Unit 201', 'DOC-2026-TEL-B002-201'),
    ('APP-TEL-2026-002', '72541DC5174453-B02-F002-U202', 'Flat 202', 2, 'Residential', 8.0, 24.0, 3.0, 6.0, 9.0, 192.0, '#AA96DA', 'Allotted Holder Unit 202', 'DOC-2026-TEL-B002-2391')
ON CONFLICT (ulpin_3d) DO NOTHING;

-- Parcel B001 (Pragathi Heights - Approved / Deed Sealed)
INSERT INTO cadastral_parcels_2d (ulpin_2d, survey_number, plot_number, district, state, pin_code, address, latitude, longitude)
VALUES (
    '58291AB4918231',
    'SY-3127',
    'Plot 05',
    'Medchal-Malkajgiri',
    'Telangana',
    '500047',
    'Survey No. 3127, Malkajgiri Axis, Medchal-Malkajgiri, Hyderabad 500047',
    17.452100,
    78.379800
) ON CONFLICT (ulpin_2d) DO NOTHING;

INSERT INTO building_structures_3d (application_id, ulpin_2d, building_code, building_name, total_floors, flats_per_floor, building_length_m, building_width_m, building_height_m, floor_height_m, status, spatial_quality)
VALUES (
    'APP-TEL-2026-001',
    '58291AB4918231',
    'B001',
    'Pragathi Heights',
    5,
    3,
    32.0,
    22.0,
    15.0,
    3.0,
    'Approved',
    'Survey_Grade'
) ON CONFLICT (application_id) DO NOTHING;

-- Parcel B003 (Green Heights Enclave - Pending Town Planner)
INSERT INTO cadastral_parcels_2d (ulpin_2d, survey_number, plot_number, district, state, pin_code, address, latitude, longitude)
VALUES (
    '91827EF3847291',
    'SY-180/P',
    'Plot 42',
    'Rangareddy',
    'Telangana',
    '500081',
    'Survey No. SY-180/P, Plot 42, Green Heights Enclave, Madhapur, Hyderabad',
    17.439120,
    78.391240
) ON CONFLICT (ulpin_2d) DO NOTHING;

INSERT INTO building_structures_3d (application_id, ulpin_2d, building_code, building_name, total_floors, flats_per_floor, building_length_m, building_width_m, building_height_m, floor_height_m, status, spatial_quality)
VALUES (
    'APP-TEL-2026-003',
    '91827EF3847291',
    'B003',
    'Green Heights Enclave',
    4,
    3,
    28.0,
    18.0,
    12.0,
    3.0,
    'Pending_Town_Planner',
    'Parametric_Fallback'
) ON CONFLICT (application_id) DO NOTHING;

-- Parcel B004 (Apex Sky View - Rejected Revision Queue)
INSERT INTO cadastral_parcels_2d (ulpin_2d, survey_number, plot_number, district, state, pin_code, address, latitude, longitude)
VALUES (
    '63819GH2948102',
    'SY-509/2',
    'Plot 101',
    'Medchal',
    'Telangana',
    '500047',
    'Survey No. SY-509/2, Apex Sky View, Malkajgiri North Highway',
    17.441000,
    78.388000
) ON CONFLICT (ulpin_2d) DO NOTHING;

INSERT INTO building_structures_3d (application_id, ulpin_2d, building_code, building_name, total_floors, flats_per_floor, building_length_m, building_width_m, building_height_m, floor_height_m, status, spatial_quality)
VALUES (
    'APP-TEL-2026-004',
    '63819GH2948102',
    'B004',
    'Apex Sky View',
    6,
    4,
    36.0,
    24.0,
    19.5,
    3.25,
    'Rejected_By_Planner',
    'Survey_Grade'
) ON CONFLICT (application_id) DO NOTHING;

-- Audit History Seed Logs
INSERT INTO cadastre_audit_history (application_id, author_role, author_name, status_change, remarks)
VALUES 
    ('APP-TEL-2026-004', 'Town_Planner', 'Dr. Aruna Rao (Chief Town Planner)', 'Pending_Town_Planner -> Rejected_By_Planner', 'Building height of 19.5m exceeds zonal permissible ceiling of 18.0m. Reduce floor count to 5 or adjust floor height to <= 3.0m.'),
    ('APP-TEL-2026-002', 'Town_Planner', 'Dr. Aruna Rao (Chief Town Planner)', 'Pending_Town_Planner -> Pending_SRO', 'Geometric bye-laws validated. FAR 1.8 <= 2.50. Height 9.0m compliant.')
ON CONFLICT DO NOTHING;
