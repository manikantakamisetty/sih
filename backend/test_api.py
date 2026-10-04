"""
Comprehensive Test Suite for 3D Cadastral API & State Machine.
Tests:
- Geocoding and Google Maps URL parsing
- Flexible fallback ingestion & bulk flat expansion
- 3D ULPIN generation formula
- Town Planner compliance and rejection rollback
- SRO Deed sealing and rejection rollback
- Citizen Read-Only lookup
"""

import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.cadastre_engine import resolve_location_input, generate_3d_ulpin

client = TestClient(app)


def test_location_resolver_google_maps_url():
    url = "https://www.google.com/maps/@17.448293,78.384210,17z"
    coords = resolve_location_input(url)
    assert coords.latitude == 17.448293
    assert coords.longitude == 78.384210


def test_location_resolver_lat_lng():
    coord_str = "17.4521, 78.3798"
    coords = resolve_location_input(coord_str)
    assert coords.latitude == 17.4521
    assert coords.longitude == 78.3798


def test_generate_3d_ulpin_formula():
    ulpin_3d = generate_3d_ulpin("72541DC5174453", 1, 2, "Flat 202")
    assert ulpin_3d == "72541DC5174453-B01-F002-U202"

    ground_ulpin = generate_3d_ulpin("72541DC5174453", 1, 0, "Parking 1")
    assert ground_ulpin == "72541DC5174453-B01-F000-U001"


def test_surveyor_intake_and_calculation():
    payload = {
        "raw_location": "Madhapur, Hyderabad",
        "latitude": 17.448293,
        "longitude": 78.384210,
        "building_name": "Apex Test Tower",
        "ulpin_2d": "72541DC5174453",
        "total_floors": 4,
        "flats_per_floor": 3,
        "building_length": 30.0,
        "building_width": 20.0,
        "floor_height": 3.0,
        "is_identical_flats": True
    }
    response = client.post("/api/cadastre/surveyor/calculate-3d", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert len(data["building_params"]["floors"]) == 4
    assert len(data["building_params"]["floors"][1]["flats"]) == 3
    # Check 3D ULPIN format
    sample_flat = data["building_params"]["floors"][1]["flats"][0]
    assert "72541DC5174453-B01-F001" in sample_flat["ulpin_3d"]


def test_town_planner_rejection_rollback():
    # 1. Submit application
    submit_payload = {
        "raw_location": "Malkajgiri, Hyderabad",
        "latitude": 17.4410,
        "longitude": 78.3880,
        "building_name": "Rollback Test Tower",
        "ulpin_2d": "TEST998811",
        "total_floors": 6,
        "flats_per_floor": 4,
        "building_length": 30.0,
        "building_width": 20.0,
        "floor_height": 3.0
    }
    sub_res = client.post("/api/cadastre/surveyor/submit", json=submit_payload)
    app_id = sub_res.json()["application_id"]

    # 2. Reject by Planner with remarks
    rej_payload = {
        "author_role": "Town_Planner",
        "author_name": "Chief Planner",
        "remarks": "Exceeds permissible FSI/FAR limit. Reduce 1 floor."
    }
    rej_res = client.post(f"/api/cadastre/planner/{app_id}/reject", json=rej_payload)
    assert rej_res.status_code == 200
    rej_data = rej_res.json()
    assert rej_data["status"] == "Rejected_By_Planner"
    assert len(rej_data["audit_history"]) > 0
    assert "Exceeds permissible FSI/FAR" in rej_data["audit_history"][-1]["remarks"]


def test_sro_sealing_and_citizen_lookup():
    # Fetch B002
    app_id = "APP-TEL-2026-002"
    seal_payload = {
        "author_role": "SRO",
        "author_name": "M. S. Reddy, IGRS",
        "deed_reference": "DOC-2026-TEL-B002-2391"
    }
    seal_res = client.post(f"/api/cadastre/sro/{app_id}/seal-deed", json=seal_payload)
    assert seal_res.status_code == 200
    assert seal_res.json()["status"] == "Approved"

    # Citizen Lookup
    citizen_res = client.get("/api/cadastre/citizen/lookup/72541DC5174453")
    assert citizen_res.status_code == 200
    assert citizen_res.json()["is_read_only"] is True
    assert citizen_res.json()["building_params"]["building_id"] == "B002"
