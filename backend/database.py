"""
Database repository for 3D Cadastral applications.
Seamlessly connects to Supabase (PostGIS & PostgreSQL) when credentials are provided in .env,
and provides robust local in-memory persistence as a graceful fallback.
"""

import os
from typing import Dict, List, Optional
from datetime import datetime

# Simple built-in .env parser
def load_env_file(filepath: str = ".env"):
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        k, v = line.split("=", 1)
                        k = k.strip()
                        v = v.strip().strip("'").strip('"')
                        if k and k not in os.environ:
                            os.environ[k] = v
        except Exception:
            pass

load_env_file()

from .models import (
    CadastralApplication,
    CadastreStatus,
    GeoCoordinate,
    BuildingParameters,
    AuditRemark,
    SpatialDataQuality,
    UploadedFileMeta
)
from .cadastre_engine import expand_bulk_flats, evaluate_geometric_compliance, evaluate_sro_legal_audit

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.getenv("SUPABASE_KEY", os.getenv("SUPABASE_SERVICE_ROLE_KEY", os.getenv("SUPABASE_ANON_KEY", ""))).strip()

supabase_client = None
if SUPABASE_URL and SUPABASE_KEY and "your-project-id" not in SUPABASE_URL:
    try:
        from supabase import create_client, Client
        supabase_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print(f"[Supabase] Connected to database: {SUPABASE_URL}")
    except Exception as e:
        print(f"[Supabase] Connection failed: {e}. Falling back to local state repository.")
        supabase_client = None
else:
    print("[Supabase] No active credentials in .env. Running with fast local cadastral repository.")


class CadastreRepository:
    def __init__(self):
        self._applications: Dict[str, CadastralApplication] = {}
        self._seed_initial_data()
        if supabase_client:
            self._sync_from_supabase()

    def _seed_initial_data(self):
        """Pre-populates realistic cadastral parcels matching government portal queues."""
        # 1. B002: Awaiting SRO Deed (Madhapur, Hyderabad)
        b002_coords = GeoCoordinate(
            latitude=17.448293,
            longitude=78.384210,
            address="Plot 18, Cyber Towers Sector, Madhapur, Rangareddy, Hyderabad, Telangana 500081",
            district="Rangareddy",
            state="Telangana",
            survey_number="SY-402/1A",
            plot_number="Plot 18"
        )
        b002_params = BuildingParameters(
            building_id="B002",
            building_number=2,
            building_name="Cyber Stratum Enclave",
            ulpin_2d="72541DC5174453",
            total_floors=3,
            flats_per_floor=2,
            building_length=24.0,
            building_width=16.0,
            building_height=9.0,
            floor_height=3.0,
            spatial_quality=SpatialDataQuality.SURVEY_GRADE
        )
        b002_params = expand_bulk_flats(b002_params)
        
        b002_app = CadastralApplication(
            application_id="APP-TEL-2026-002",
            ulpin_2d="72541DC5174453",
            coordinates=b002_coords,
            building_params=b002_params,
            status=CadastreStatus.PENDING_SRO,
            audit_history=[
                AuditRemark(
                    id="AUD-001",
                    author_role="Surveyor",
                    author_name="K. Ramanathan (Licensed Cadastral Surveyor)",
                    status_change="Draft -> Pending_Town_Planner",
                    remarks="LiDAR point cloud (0.05m GSD) and parametric floor strata boundaries submitted.",
                    affected_components=["All 3 Floors", "Ground Utilities"]
                ),
                AuditRemark(
                    id="AUD-002",
                    author_role="Town_Planner",
                    author_name="Dr. Aruna Rao (Chief Town Planner, HMDA)",
                    status_change="Pending_Town_Planner -> Pending_SRO",
                    remarks="Geometric bye-laws validated. FAR 1.8 <= 2.50. Height 9.0m compliant.",
                    affected_components=["Building Volume Mesh", "Fire Access"]
                )
            ],
            planner_compliance_report=evaluate_geometric_compliance(b002_params, b002_coords),
            sro_audit_report=evaluate_sro_legal_audit(b002_params)
        )
        self._applications[b002_app.application_id] = b002_app

        # 2. B001: Deed Sealed (Approved)
        b001_coords = GeoCoordinate(
            latitude=17.452100,
            longitude=78.379800,
            address="Survey No. 3127, Malkajgiri Axis, Medchal-Malkajgiri, Hyderabad 500047",
            district="Medchal-Malkajgiri",
            state="Telangana",
            survey_number="SY-3127",
            plot_number="Plot 05"
        )
        b001_params = BuildingParameters(
            building_id="B001",
            building_number=1,
            building_name="Pragathi Heights",
            ulpin_2d="58291AB4918231",
            total_floors=5,
            flats_per_floor=3,
            building_length=32.0,
            building_width=22.0,
            building_height=15.0,
            floor_height=3.0,
            spatial_quality=SpatialDataQuality.SURVEY_GRADE
        )
        b001_params = expand_bulk_flats(b001_params)
        b001_app = CadastralApplication(
            application_id="APP-TEL-2026-001",
            ulpin_2d="58291AB4918231",
            coordinates=b001_coords,
            building_params=b001_params,
            status=CadastreStatus.APPROVED,
            audit_history=[
                AuditRemark(
                    id="AUD-000",
                    author_role="SRO",
                    author_name="M. S. Reddy, IGRS (Authorized Registrar)",
                    status_change="Pending_SRO -> Approved (Deed Sealed)",
                    remarks="All vertical strata registered under DOC-2026-TEL-3127-01. Immutable 3D ULPINs minted.",
                    affected_components=["Units G01-G03, F101-F503"]
                )
            ],
            planner_compliance_report=evaluate_geometric_compliance(b001_params, b001_coords),
            sro_audit_report=evaluate_sro_legal_audit(b001_params)
        )
        self._applications[b001_app.application_id] = b001_app

        # 3. B003: In Municipal Audit (Pending Town Planner)
        b003_coords = GeoCoordinate(
            latitude=17.439120,
            longitude=78.391240,
            address="Survey No. SY-180/P, Plot 42, Green Heights Enclave, Madhapur, Hyderabad",
            district="Rangareddy",
            state="Telangana",
            survey_number="SY-180/P",
            plot_number="Plot 42"
        )
        b003_params = BuildingParameters(
            building_id="B003",
            building_number=3,
            building_name="Green Heights Enclave",
            ulpin_2d="91827EF3847291",
            total_floors=4,
            flats_per_floor=3,
            building_length=28.0,
            building_width=18.0,
            building_height=12.0,
            floor_height=3.0,
            spatial_quality=SpatialDataQuality.PARAMETRIC_FALLBACK
        )
        b003_params = expand_bulk_flats(b003_params)
        b003_app = CadastralApplication(
            application_id="APP-TEL-2026-003",
            ulpin_2d="91827EF3847291",
            coordinates=b003_coords,
            building_params=b003_params,
            status=CadastreStatus.PENDING_TOWN_PLANNER,
            audit_history=[
                AuditRemark(
                    id="AUD-003",
                    author_role="Surveyor",
                    author_name="K. Ramanathan",
                    status_change="Draft -> Pending_Town_Planner",
                    remarks="Parametric cadastral intake submitted with bulk flat configuration.",
                    affected_components=["Structure B003"]
                )
            ],
            planner_compliance_report=evaluate_geometric_compliance(b003_params, b003_coords),
            sro_audit_report=evaluate_sro_legal_audit(b003_params)
        )
        self._applications[b003_app.application_id] = b003_app

        # 4. B004: Rejected Revisions (Surveyor Queue)
        b004_coords = GeoCoordinate(
            latitude=17.441000,
            longitude=78.388000,
            address="Survey No. SY-509/2, Apex Sky View, Malkajgiri North Highway",
            district="Medchal",
            state="Telangana",
            survey_number="SY-509/2",
            plot_number="Plot 101"
        )
        b004_params = BuildingParameters(
            building_id="B004",
            building_number=4,
            building_name="Apex Sky View",
            ulpin_2d="63819GH2948102",
            total_floors=6,
            flats_per_floor=4,
            building_length=36.0,
            building_width=24.0,
            building_height=19.5,  # Exceeds 18m limit
            floor_height=3.25,
            spatial_quality=SpatialDataQuality.SURVEY_GRADE
        )
        b004_params = expand_bulk_flats(b004_params)
        b004_app = CadastralApplication(
            application_id="APP-TEL-2026-004",
            ulpin_2d="63819GH2948102",
            coordinates=b004_coords,
            building_params=b004_params,
            status=CadastreStatus.REJECTED_BY_PLANNER,
            audit_history=[
                AuditRemark(
                    id="AUD-004",
                    author_role="Town_Planner",
                    author_name="Dr. Aruna Rao (Chief Town Planner)",
                    status_change="Pending_Town_Planner -> Rejected_By_Planner",
                    remarks="Building height of 19.5m exceeds zonal permissible ceiling of 18.0m. Reduce floor count to 5 or adjust floor height to <= 3.0m.",
                    affected_components=["Floor 5 Elevation", "Total Building Height"]
                )
            ],
            planner_compliance_report=evaluate_geometric_compliance(b004_params, b004_coords),
            sro_audit_report=evaluate_sro_legal_audit(b004_params)
        )
        self._applications[b004_app.application_id] = b004_app

    def _sync_from_supabase(self):
        """Pulls latest records from Supabase tables into local cache."""
        if not supabase_client:
            return
        try:
            res = supabase_client.table("building_structures_3d").select("*").execute()
            if res.data:
                for row in res.data:
                    app_id = row.get("application_id")
                    if app_id and row.get("building_json"):
                        bldg_data = row.get("building_json")
                        bldg = BuildingParameters(**bldg_data)
                        if app_id in self._applications:
                            self._applications[app_id].building_params = bldg
                            self._applications[app_id].status = CadastreStatus(row.get("status", "Draft"))
        except Exception as err:
            print(f"[Supabase Sync] Warning: {err}")

    def list_applications(self, status: Optional[CadastreStatus] = None) -> List[CadastralApplication]:
        apps = list(self._applications.values())
        if status:
            apps = [a for a in apps if a.status == status]
        return sorted(apps, key=lambda x: x.created_at, reverse=True)

    def get_application(self, app_id: str) -> Optional[CadastralApplication]:
        return self._applications.get(app_id)

    def find_by_ulpin(self, ulpin: str) -> Optional[CadastralApplication]:
        cleaned = ulpin.strip().upper()
        for app in self._applications.values():
            if app.ulpin_2d.upper() == cleaned or app.building_params.ulpin_2d.upper() == cleaned:
                return app
            for floor in app.building_params.floors:
                for flat in floor.flats:
                    if flat.ulpin_3d and flat.ulpin_3d.upper() == cleaned:
                        return app
        return None

    def save_application(self, app: CadastralApplication) -> CadastralApplication:
        app.updated_at = datetime.utcnow()
        app.planner_compliance_report = evaluate_geometric_compliance(app.building_params, app.coordinates)
        app.sro_audit_report = evaluate_sro_legal_audit(app.building_params)
        self._applications[app.application_id] = app

        # Write to Supabase if client is active
        if supabase_client:
            try:
                # 1. Upsert Parcel
                supabase_client.table("cadastral_parcels_2d").upsert({
                    "ulpin_2d": app.ulpin_2d,
                    "survey_number": app.coordinates.survey_number,
                    "plot_number": app.coordinates.plot_number or "Plot",
                    "district": app.coordinates.district,
                    "state": app.coordinates.state,
                    "pin_code": app.coordinates.pin_code or "500081",
                    "address": app.coordinates.address,
                    "latitude": app.coordinates.latitude,
                    "longitude": app.coordinates.longitude
                }, on_conflict="ulpin_2d").execute()

                # 2. Upsert Building Structure
                supabase_client.table("building_structures_3d").upsert({
                    "application_id": app.application_id,
                    "ulpin_2d": app.ulpin_2d,
                    "building_code": app.building_params.building_id,
                    "building_name": app.building_params.building_name,
                    "total_floors": app.building_params.total_floors,
                    "flats_per_floor": app.building_params.flats_per_floor,
                    "building_length_m": app.building_params.building_length,
                    "building_width_m": app.building_params.building_width,
                    "building_height_m": app.building_params.building_height,
                    "floor_height_m": app.building_params.floor_height,
                    "status": app.status.value,
                    "building_json": app.building_params.dict()
                }, on_conflict="application_id").execute()

                # 3. Upsert Strata Units
                for floor in app.building_params.floors:
                    for flat in floor.flats:
                        supabase_client.table("vertical_strata_units_3d").upsert({
                            "application_id": app.application_id,
                            "ulpin_3d": flat.ulpin_3d,
                            "flat_code": flat.flat_number,
                            "floor_number": floor.floor_number,
                            "unit_type": flat.unit_type if flat.unit_type in ["Residential", "Commercial", "Parking", "Utility", "Common_Area", "Penthouse"] else "Residential",
                            "width_m": flat.width,
                            "length_m": flat.length,
                            "height_m": flat.height,
                            "elevation_bottom_m": floor.elevation_bottom,
                            "elevation_top_m": floor.elevation_top,
                            "area_sqm": flat.area_sqm,
                            "color_hex": flat.color_hex,
                            "owner_name": flat.owner_name,
                            "owner_share_pct": flat.owner_share_pct,
                            "deed_reference": flat.deed_reference,
                            "is_planner_accepted": flat.accepted_by_planner,
                            "is_sro_accepted": flat.accepted_by_sro
                        }, on_conflict="ulpin_3d").execute()

                # 4. Insert Audit History
                if app.audit_history:
                    latest = app.audit_history[-1]
                    supabase_client.table("cadastre_audit_history").insert({
                        "application_id": app.application_id,
                        "author_role": latest.author_role,
                        "author_name": latest.author_name,
                        "status_change": latest.status_change,
                        "remarks": latest.remarks,
                        "affected_components": latest.affected_components
                    }).execute()
                    
                print(f"[Supabase] Synced application {app.application_id} to Supabase cloud.")
            except Exception as e:
                print(f"[Supabase] Failed to write to cloud: {e}")

        return app


# Global repository instance
db_repo = CadastreRepository()
