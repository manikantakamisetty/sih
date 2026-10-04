"""
FastAPI Backend Application for 3D Cadastral Web Framework.
Exposes REST endpoints for Surveyor, Town Planner, SRO, and Citizen Portals.
"""

import uuid
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import uvicorn

from .models import (
    CadastreStatus,
    CadastralApplication,
    GeoCoordinate,
    BuildingParameters,
    LocationIntakeRequest,
    RejectionRequest,
    ApprovalRequest,
    AuditRemark,
    UploadedFileMeta,
    SpatialDataQuality
)
from .cadastre_engine import (
    resolve_location_input,
    validate_spatial_intake,
    expand_bulk_flats,
    evaluate_geometric_compliance,
    evaluate_sro_legal_audit,
    generate_3d_ulpin
)
from .database import db_repo

app = FastAPI(
    title="National 3D ULPIN & Vertical Cadastre API",
    description="Multi-role 3D Cadastral Lifecycle System for DILRMP / Ministry of Land Resources",
    version="2.0.0"
)

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# -------------------------------------------------------------
# 1. Location & Geocoding Intake Endpoints
# -------------------------------------------------------------

@app.post("/api/cadastre/resolve-location", response_model=GeoCoordinate)
def resolve_location(req: LocationIntakeRequest):
    """
    Parses an address, coordinates, or Google Maps URL with optional drag-and-drop overrides.
    """
    coords = resolve_location_input(req.raw_input, req.override_lat, req.override_lng)
    return coords


# -------------------------------------------------------------
# 2. Surveyor Workflow Endpoints
# -------------------------------------------------------------

class SurveyorIntakePayload(BaseModel):
    application_id: Optional[str] = None
    raw_location: str
    latitude: float
    longitude: float
    address: Optional[str] = None
    district: Optional[str] = "Rangareddy"
    survey_number: Optional[str] = "SY-402/1A"
    building_name: str = "Apex Sky View"
    ulpin_2d: str = "72541DC5174453"
    total_floors: int = 4
    flats_per_floor: int = 3
    building_length: float = 30.0
    building_width: float = 20.0
    floor_height: float = 3.0
    is_identical_flats: bool = True
    flat_overrides: Optional[Dict[str, Dict[str, Any]]] = None
    uploaded_file_names: Optional[List[str]] = None


@app.post("/api/cadastre/surveyor/calculate-3d", response_model=CadastralApplication)
def calculate_3d_structure(payload: SurveyorIntakePayload):
    """
    Calculates 3D structure, applies bulk expansion, overrides, and generates individual 3D ULPINs.
    """
    app_id = payload.application_id or f"APP-TEL-{uuid.uuid4().hex[:6].upper()}"
    existing_app = db_repo.get_application(app_id)
    
    coords = GeoCoordinate(
        latitude=payload.latitude,
        longitude=payload.longitude,
        address=payload.address or "Surveyed Parcel, Madhapur, Hyderabad",
        district=payload.district or "Rangareddy",
        survey_number=payload.survey_number or "SY-402/1A"
    )
    
    bldg = BuildingParameters(
        building_id=f"B{payload.ulpin_2d[-3:]}" if len(payload.ulpin_2d) >= 3 else "B001",
        building_number=1,
        building_name=payload.building_name,
        ulpin_2d=payload.ulpin_2d,
        total_floors=payload.total_floors,
        flats_per_floor=payload.flats_per_floor,
        building_length=payload.building_length,
        building_width=payload.building_width,
        floor_height=payload.floor_height,
        is_identical_flats=payload.is_identical_flats
    )
    
    bldg = expand_bulk_flats(bldg, payload.flat_overrides)
    
    # Metadata for mock files if any
    files_meta = []
    if payload.uploaded_file_names:
        for fname in payload.uploaded_file_names:
            ftype = "lidar" if (".las" in fname or ".laz" in fname) else "drone" if (".tif" in fname) else "cad"
            files_meta.append(UploadedFileMeta(
                id=uuid.uuid4().hex[:8],
                filename=fname,
                file_type=ftype,
                size_bytes=14520900
            ))
            
    quality, gaps, bldg = validate_spatial_intake(files_meta, bldg)
    
    status = existing_app.status if existing_app else CadastreStatus.DRAFT
    audit_history = existing_app.audit_history if existing_app else []

    app = CadastralApplication(
        application_id=app_id,
        ulpin_2d=payload.ulpin_2d,
        coordinates=coords,
        building_params=bldg,
        uploaded_files=files_meta,
        status=status,
        audit_history=audit_history
    )
    
    db_repo.save_application(app)
    return app


@app.post("/api/cadastre/surveyor/submit", response_model=CadastralApplication)
def submit_to_town_planner(payload: SurveyorIntakePayload):
    """
    Submits or resubmits application to Town Planner queue with audit trail.
    """
    app = calculate_3d_structure(payload)
    prev_status = app.status
    app.status = CadastreStatus.PENDING_TOWN_PLANNER
    
    remark_text = "Cadastral intake parameters submitted for municipal geometric validation."
    if prev_status in [CadastreStatus.REJECTED_BY_PLANNER, CadastreStatus.REJECTED_BY_SRO]:
        remark_text = f"Resubmitted with updated parameters following revision from {prev_status.value}."

    app.audit_history.append(AuditRemark(
        id=f"AUD-{uuid.uuid4().hex[:6].upper()}",
        author_role="Surveyor",
        author_name="K. Ramanathan (Cadastral Surveyor)",
        status_change=f"{prev_status.value} -> Pending_Town_Planner",
        remarks=remark_text,
        affected_components=["All Floors", "3D Strata Mesh"]
    ))
    
    db_repo.save_application(app)
    return app


# -------------------------------------------------------------
# 3. Town Planner Portal Endpoints
# -------------------------------------------------------------

@app.get("/api/cadastre/planner/queue", response_model=List[CadastralApplication])
def get_planner_queue():
    """Returns applications awaiting Town Planner review or active in municipal audit."""
    return db_repo.list_applications()


@app.post("/api/cadastre/planner/{app_id}/approve", response_model=CadastralApplication)
def planner_approve(app_id: str, req: ApprovalRequest):
    app = db_repo.get_application(app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
        
    app.status = CadastreStatus.PENDING_SRO
    app.audit_history.append(AuditRemark(
        id=f"AUD-{uuid.uuid4().hex[:6].upper()}",
        author_role="Town_Planner",
        author_name=req.author_name,
        status_change="Pending_Town_Planner -> Pending_SRO",
        remarks=req.remarks or "Municipal bye-law geometric compliance approved. Escalated to SRO for title deed linking.",
        affected_components=["Building Volume", "Setbacks", "FAR"]
    ))
    db_repo.save_application(app)
    return app


@app.post("/api/cadastre/planner/{app_id}/reject", response_model=CadastralApplication)
def planner_reject(app_id: str, req: RejectionRequest):
    if not req.remarks.strip():
        raise HTTPException(status_code=400, detail="Rejection requires mandatory text remarks.")
        
    app = db_repo.get_application(app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
        
    # State Rollback to Surveyor
    app.status = CadastreStatus.REJECTED_BY_PLANNER
    app.audit_history.append(AuditRemark(
        id=f"AUD-{uuid.uuid4().hex[:6].upper()}",
        author_role="Town_Planner",
        author_name=req.author_name,
        status_change="Pending_Town_Planner -> Rejected_By_Planner",
        remarks=req.remarks,
        affected_components=req.rejected_items or ["Geometric Parameters"]
    ))
    db_repo.save_application(app)
    return app


# -------------------------------------------------------------
# 4. SRO (Sub-Registrar Office) Portal Endpoints
# -------------------------------------------------------------

@app.get("/api/cadastre/sro/queue", response_model=List[CadastralApplication])
def get_sro_queue():
    return db_repo.list_applications()


@app.post("/api/cadastre/sro/{app_id}/seal-deed", response_model=CadastralApplication)
def sro_seal_deed(app_id: str, req: ApprovalRequest):
    app = db_repo.get_application(app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
        
    deed_doc = req.deed_reference or f"DOC-2026-TEL-{app.building_params.building_id}-001"
    app.status = CadastreStatus.APPROVED
    
    # Mark all units verified & link deed
    for floor in app.building_params.floors:
        for flat in floor.flats:
            flat.deed_reference = deed_doc
            flat.accepted_by_sro = True
            
    app.audit_history.append(AuditRemark(
        id=f"AUD-{uuid.uuid4().hex[:6].upper()}",
        author_role="SRO",
        author_name=req.author_name,
        status_change="Pending_SRO -> Approved (Deed Sealed)",
        remarks=f"Registered and locked 3D cadastral strata under Deed Reference: {deed_doc}. Official 3D ULPINs published.",
        affected_components=["All Vertical Strata Units"]
    ))
    db_repo.save_application(app)
    return app


@app.post("/api/cadastre/sro/{app_id}/reject", response_model=CadastralApplication)
def sro_reject(app_id: str, req: RejectionRequest):
    if not req.remarks.strip():
        raise HTTPException(status_code=400, detail="Rejection requires mandatory text remarks.")
        
    app = db_repo.get_application(app_id)
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
        
    # State Rollback to Surveyor
    app.status = CadastreStatus.REJECTED_BY_SRO
    app.audit_history.append(AuditRemark(
        id=f"AUD-{uuid.uuid4().hex[:6].upper()}",
        author_role="SRO",
        author_name=req.author_name,
        status_change="Pending_SRO -> Rejected_By_SRO",
        remarks=req.remarks,
        affected_components=req.rejected_items or ["Title Deed Records"]
    ))
    db_repo.save_application(app)
    return app


# -------------------------------------------------------------
# 5. Citizen Read-Only Portal Endpoints
# -------------------------------------------------------------

@app.get("/api/cadastre/citizen/lookup/{ulpin_or_deed}")
def citizen_lookup(ulpin_or_deed: str):
    """
    Public lookup by 2D ULPIN, 3D ULPIN, or Registered Deed Reference.
    Strictly read-only.
    """
    app = db_repo.find_by_ulpin(ulpin_or_deed)
    if not app:
        # Check by deed reference
        cleaned = ulpin_or_deed.strip().upper()
        for candidate in db_repo.list_applications():
            for floor in candidate.building_params.floors:
                for flat in floor.flats:
                    if flat.deed_reference and flat.deed_reference.upper() == cleaned:
                        app = candidate
                        break
            if app:
                break
                
    if not app:
        raise HTTPException(status_code=404, detail=f"No Cadastral parcel or 3D strata found for: {ulpin_or_deed}")
        
    return {
        "application_id": app.application_id,
        "ulpin_2d": app.ulpin_2d,
        "status": app.status,
        "coordinates": app.coordinates,
        "building_params": app.building_params,
        "audit_history": app.audit_history,
        "is_read_only": True
    }


# -------------------------------------------------------------
# 6. Static Web Frontend Mount
# -------------------------------------------------------------

static_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def serve_index():
    index_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "3D Cadastral System API running. Static index.html not yet placed."}


if __name__ == "__main__":
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
