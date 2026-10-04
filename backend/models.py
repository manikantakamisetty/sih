"""
Data models, Enums, and Pydantic Schemas for 3D Cadastral Web Framework.
"""

from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime


class CadastreStatus(str, Enum):
    DRAFT = "Draft"
    PENDING_TOWN_PLANNER = "Pending_Town_Planner"
    PENDING_SRO = "Pending_SRO"
    APPROVED = "Approved"
    REJECTED_BY_PLANNER = "Rejected_By_Planner"
    REJECTED_BY_SRO = "Rejected_By_SRO"


class UnitType(str, Enum):
    RESIDENTIAL = "Residential"
    COMMERCIAL = "Commercial"
    PARKING = "Parking"
    UTILITY = "Utility"
    COMMON_AREA = "Common_Area"


class SpatialDataQuality(str, Enum):
    SURVEY_GRADE = "Survey_Grade"
    PARAMETRIC_FALLBACK = "Parametric_Fallback"
    PRELIMINARY_ESTIMATED = "Preliminary_Estimated"


class GeoCoordinate(BaseModel):
    latitude: float = Field(..., ge=-90.0, le=90.0)
    longitude: float = Field(..., ge=-180.0, le=180.0)
    address: Optional[str] = None
    district: Optional[str] = "Rangareddy"
    state: Optional[str] = "Telangana"
    pin_code: Optional[str] = "500081"
    survey_number: Optional[str] = "SY-402/1A"
    plot_number: Optional[str] = "Plot 18"


class FlatDimension(BaseModel):
    flat_id: str
    flat_number: str
    floor_number: int  # 0 for Ground, 1 for Floor 1, etc.
    unit_type: UnitType = UnitType.RESIDENTIAL
    width: float = Field(..., gt=0)   # in meters
    length: float = Field(..., gt=0)  # in meters
    height: float = Field(..., gt=0)  # in meters
    area_sqm: float = Field(..., gt=0)
    color_hex: str = "#4ECDC4"
    owner_name: Optional[str] = "Allotted Holder"
    owner_share_pct: float = 100.0
    deed_reference: Optional[str] = None
    ulpin_3d: Optional[str] = None
    accepted_by_planner: bool = True
    accepted_by_sro: bool = True
    rejection_reasons: List[str] = []


class FloorStructure(BaseModel):
    floor_number: int
    floor_label: str  # "Ground", "Floor 1", "Floor 2", etc.
    floor_height: float = 3.0
    elevation_bottom: float = 0.0
    elevation_top: float = 3.0
    flats: List[FlatDimension] = []


class BuildingParameters(BaseModel):
    building_id: str = "B001"
    building_number: int = 1
    building_name: str = "Apex Sky View"
    ulpin_2d: str = "72541DC5174453"
    total_floors: int = 4  # e.g., Ground + 3 Floors
    flats_per_floor: int = 3
    building_length: float = 30.0  # meters
    building_width: float = 20.0   # meters
    building_height: float = 12.0  # meters
    floor_height: float = 3.0      # meters
    is_identical_flats: bool = True
    floors: List[FloorStructure] = []
    spatial_quality: SpatialDataQuality = SpatialDataQuality.SURVEY_GRADE


class UploadedFileMeta(BaseModel):
    id: str
    filename: str
    file_type: str  # 'drone', 'lidar', 'gis', 'cad'
    size_bytes: int
    upload_timestamp: datetime = Field(default_factory=datetime.utcnow)
    extracted_features: Dict[str, Any] = {}


class AuditRemark(BaseModel):
    id: str
    author_role: str  # "Town_Planner" or "SRO" or "Surveyor"
    author_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    status_change: str
    remarks: str
    affected_components: List[str] = []


class CadastralApplication(BaseModel):
    application_id: str
    ulpin_2d: str
    coordinates: GeoCoordinate
    building_params: BuildingParameters
    uploaded_files: List[UploadedFileMeta] = []
    status: CadastreStatus = CadastreStatus.DRAFT
    audit_history: List[AuditRemark] = []
    planner_compliance_report: Optional[Dict[str, Any]] = None
    sro_audit_report: Optional[Dict[str, Any]] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class LocationIntakeRequest(BaseModel):
    raw_input: str  # Address, Lat/Long, or Google Maps URL
    override_lat: Optional[float] = None
    override_lng: Optional[float] = None


class RejectionRequest(BaseModel):
    author_role: str  # "Town_Planner" or "SRO"
    author_name: str
    remarks: str
    rejected_items: List[str] = []


class ApprovalRequest(BaseModel):
    author_role: str
    author_name: str
    remarks: Optional[str] = "Approved without modifications"
    deed_reference: Optional[str] = None
