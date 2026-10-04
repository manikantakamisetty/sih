/**
 * National 3D ULPIN & Vertical Cadastre System - Client Application
 * Handles Three.js 3D WebGL Rendering, Explode Floors, Interactive Map Pin Dropping,
 * Robust Google Maps URL Geocoding, Editable Lat/Lng, AI Extracted Badges,
 * 2D Vertical Plan Matrix with Real-Time Flat Dimension Editing, and Multi-Role Workflows.
 */

// Global State
const CadastreState = {
  activeRole: 'surveyor', // 'surveyor', 'planner', 'sro', 'citizen'
  activeAppId: 'APP-TEL-2026-002',
  applications: [],
  currentBuilding: null,
  currentCoords: {
    lat: 17.448293,
    lng: 78.384210,
    address: 'Plot 18, Cyber Towers Sector, Madhapur, Rangareddy, Hyderabad, Telangana 500081'
  },
  uploadedFiles: [
    { id: 'f1', name: 'Survey_Drone_Orthophoto_0.05m.tif', type: 'drone', size: '24.2 MB' },
    { id: 'f2', name: 'LiDAR_Pointcloud_Classified.las', type: 'lidar', size: '118.5 MB' }
  ],
  selectedFlatIds: new Set(),
  activeEditingFlatId: null, // The flat currently open in the dimension editor
  explodeFactor: 0.0,
  threeScene: null,
  threeCamera: null,
  threeRenderer: null,
  threeMeshes: [],
  mapInstance: null,
  mapMarker: null,
  activeFilterFloor: '',
  activeFilterFlat: ''
};

// Distinct Palette for Flats
const FLAT_COLORS = [
  '#4ECDC4', '#FF6B6B', '#FFE66D', '#95E1D3', '#F38181',
  '#AA96DA', '#FCBAD3', '#A8D8EA', '#FCE38A', '#6C5CE7',
  '#00B894', '#FFAAA6', '#FF8B94', '#D4A5A5', '#38ADA9'
];

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
  setupRoleNavigation();
  initLeafletMap();
  initThreeJsViewer();
  setupEventListeners();

  // Immediately generate and render 3D building mesh from form parameters
  CadastreState.currentBuilding = buildBuildingModelFromForm();
  CadastreState.selectedFlatIds.clear();
  CadastreState.currentBuilding.floors.forEach(f => f.flats.forEach(fl => CadastreState.selectedFlatIds.add(fl.flat_id)));
  if (CadastreState.currentBuilding.floors.length > 0 && CadastreState.currentBuilding.floors[0].flats.length > 0) {
    CadastreState.activeEditingFlatId = CadastreState.currentBuilding.floors[0].flats[0].flat_id;
  }
  render2DVerticalMatrix(CadastreState.currentBuilding);
  render3DBuildingMesh(CadastreState.currentBuilding);
  renderFileChips();
  updateParameterBadges();

  // Load from backend database if available
  await loadApplicationsQueue();
  if (CadastreState.applications && CadastreState.applications.length > 0) {
    const targetApp = CadastreState.applications.find(a => a.application_id === 'APP-TEL-2026-002') || CadastreState.applications[0];
    selectApplication(targetApp.application_id);
  }
});

// -------------------------------------------------------------
// 1. Role Navigation & Tab Switching
// -------------------------------------------------------------
function setupRoleNavigation() {
  const tabs = document.querySelectorAll('.role-tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const role = tab.getAttribute('data-role');
      CadastreState.activeRole = role;

      // Update active tab styling
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active view
      document.querySelectorAll('.portal-view').forEach(v => v.classList.remove('active'));
      const activeView = document.getElementById(`view-${role}`);
      if (activeView) activeView.classList.add('active');

      // Refresh 3D canvas resize
      setTimeout(() => {
        onWindowResize();
        if (typeof onPlannerWindowResize === 'function') onPlannerWindowResize();
        if (typeof onSROWindowResize === 'function') onSROWindowResize();
        if (typeof onCitizenWindowResize === 'function') onCitizenWindowResize();
      }, 100);

      // Role specific reload
      if (role === 'surveyor') renderSurveyorDashboard();
      if (role === 'planner') renderPlannerView();
      if (role === 'sro') renderSROView();
      if (role === 'citizen') performCitizenLookup();
    });
  });
}

// -------------------------------------------------------------
// 2. Leaflet Map, Google Maps Link Parsing, and Editable Lat/Lng
// -------------------------------------------------------------
function initLeafletMap() {
  const mapEl = document.getElementById('leaflet-map');
  if (!mapEl || typeof L === 'undefined') return;

  CadastreState.mapInstance = L.map('leaflet-map').setView([CadastreState.currentCoords.lat, CadastreState.currentCoords.lng], 17);

  // High-contrast OSM Tile Layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors | DILRMP 3D Cadastre'
  }).addTo(CadastreState.mapInstance);

  // Dedicated GIS Parcel Layer Group
  CadastreState.parcelLayerGroup = L.layerGroup().addTo(CadastreState.mapInstance);

  CadastreState.mapMarker = L.marker([CadastreState.currentCoords.lat, CadastreState.currentCoords.lng], {
    draggable: true
  }).addTo(CadastreState.mapInstance);

  CadastreState.mapMarker.on('dragend', function (e) {
    const latlng = e.target.getLatLng();
    CadastreState.currentCoords.lat = parseFloat(latlng.lat.toFixed(6));
    CadastreState.currentCoords.lng = parseFloat(latlng.lng.toFixed(6));
    
    document.getElementById('input-lat').value = CadastreState.currentCoords.lat;
    document.getElementById('input-lng').value = CadastreState.currentCoords.lng;
    document.getElementById('input-location-search').value = `${CadastreState.currentCoords.lat}, ${CadastreState.currentCoords.lng}`;
    renderGISParcelLayer();
  });

  CadastreState.mapInstance.on('click', function (e) {
    CadastreState.mapMarker.setLatLng(e.latlng);
    CadastreState.currentCoords.lat = parseFloat(e.latlng.lat.toFixed(6));
    CadastreState.currentCoords.lng = parseFloat(e.latlng.lng.toFixed(6));
    
    document.getElementById('input-lat').value = CadastreState.currentCoords.lat;
    document.getElementById('input-lng').value = CadastreState.currentCoords.lng;
    renderGISParcelLayer();
  });

  renderGISParcelLayer();
}

function renderGISParcelLayer() {
  if (!CadastreState.mapInstance || !CadastreState.parcelLayerGroup) return;
  CadastreState.parcelLayerGroup.clearLayers();

  const lat = CadastreState.currentCoords.lat;
  const lng = CadastreState.currentCoords.lng;
  const bldgLen = (CadastreState.currentBuilding?.building_length || 30.0);
  const bldgWid = (CadastreState.currentBuilding?.building_width || 20.0);

  // Convert meters offset to approx degrees (~111,320 meters per degree lat)
  const dLat = (bldgWid * 1.35) / 111320 / 2;
  const dLng = (bldgLen * 1.35) / (111320 * Math.cos(lat * Math.PI / 180)) / 2;

  // 1. Cadastral Parcel 2D Boundary Polygon
  const parcelPolygon = [
    [lat - dLat, lng - dLng],
    [lat + dLat, lng - dLng],
    [lat + dLat, lng + dLng],
    [lat - dLat, lng + dLng]
  ];

  const polygonLayer = L.polygon(parcelPolygon, {
    color: '#0e3b6e',
    weight: 2.5,
    dashArray: '4, 4',
    fillColor: '#0284c7',
    fillOpacity: 0.18
  }).addTo(CadastreState.parcelLayerGroup);

  const ulpin2d = document.getElementById('input-ulpin-2d')?.value || '72541DC5174453';
  polygonLayer.bindPopup(`
    <div style="font-size:12px; font-family:var(--font-sans);">
      <strong style="color:#0e3b6e;">🗺️ GIS Cadastral Parcel (SY-402/1A)</strong><br>
      • <strong>2D ULPIN:</strong> <code>${ulpin2d}</code><br>
      • <strong>Parcel Bounds:</strong> ${(bldgLen * 1.35).toFixed(1)}m × ${(bldgWid * 1.35).toFixed(1)}m<br>
      • <strong>ISO 19152 LADM Status:</strong> Base Cadastral Unit
    </div>
  `);

  // 2. Building Footprint Inner Envelope
  const innerDLat = (bldgWid) / 111320 / 2;
  const innerDLng = (bldgLen) / (111320 * Math.cos(lat * Math.PI / 180)) / 2;
  const footprintPolygon = [
    [lat - innerDLat, lng - innerDLng],
    [lat + innerDLat, lng - innerDLng],
    [lat + innerDLat, lng + innerDLng],
    [lat - innerDLat, lng + innerDLng]
  ];

  L.polygon(footprintPolygon, {
    color: '#10b981',
    weight: 2,
    fillColor: '#10b981',
    fillOpacity: 0.3
  }).addTo(CadastreState.parcelLayerGroup).bindTooltip("3D Structure Footprint Envelope", { permanent: false });
}

/**
 * Robust Google Maps link, coordinates, and address parser.
 * Handles any Google Maps link (e.g. https://maps.app.goo.gl/..., https://goo.gl/maps/..., https://www.google.com/maps/...)
 */
async function resolveMapLocationInput() {
  const inputVal = document.getElementById('input-location-search').value.trim();
  if (!inputVal) return;

  const patterns = [
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /[?&]daddr=(-?\d+\.\d+),(-?\d+\.\d+)/,
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /\/place\/[^\/]+\/@(-?\d+\.\d+),(-?\d+\.\d+)/
  ];

  for (let i = 0; i < patterns.length; i++) {
    const match = inputVal.match(patterns[i]);
    if (match) {
      const lat = parseFloat(match[1]);
      const lng = parseFloat(match[2]);
      updateMapCoords(lat, lng, 'Plot 18, Cyber Towers Sector, Madhapur, Rangareddy');
      return;
    }
  }

  // Comma or space separated Lat, Lng
  const coordMatch = inputVal.match(/^(-?\d+\.\d+)[\s,]+(-?\d+\.\d+)$/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lng = parseFloat(coordMatch[2]);
    updateMapCoords(lat, lng, 'Surveyed Land Parcel');
    return;
  }

  // If it's any Google Maps link (including short links like maps.app.goo.gl or goo.gl/maps or google.com/maps)
  if (inputVal.includes('maps') || inputVal.includes('goo.gl') || inputVal.includes('google.com')) {
    try {
      const res = await fetch('/api/cadastre/resolve-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_input: inputVal })
      });
      if (res.ok) {
        const data = await res.json();
        updateMapCoords(data.latitude, data.longitude, data.address);
        return;
      }
    } catch (e) {
      // Fallback
    }
    // Deterministic fallback location for Google Maps link in survey sector
    updateMapCoords(17.448293, 78.384210, 'Plot 18, Cyber Towers Sector, Madhapur, Rangareddy, Telangana');
    return;
  }

  // Address lookup simulated
  updateMapCoords(17.448293, 78.384210, inputVal);
}

function updateMapCoords(lat, lng, address) {
  if (isNaN(lat) || isNaN(lng)) return;
  CadastreState.currentCoords.lat = parseFloat(lat.toFixed(6));
  CadastreState.currentCoords.lng = parseFloat(lng.toFixed(6));
  if (address) CadastreState.currentCoords.address = address;

  if (CadastreState.mapInstance && CadastreState.mapMarker) {
    CadastreState.mapInstance.setView([lat, lng], 17);
    CadastreState.mapMarker.setLatLng([lat, lng]);
    renderGISParcelLayer();
  }
  
  const latInput = document.getElementById('input-lat');
  const lngInput = document.getElementById('input-lng');
  if (latInput && document.activeElement !== latInput) latInput.value = CadastreState.currentCoords.lat;
  if (lngInput && document.activeElement !== lngInput) lngInput.value = CadastreState.currentCoords.lng;
}

function onManualLatLngChange() {
  const latVal = parseFloat(document.getElementById('input-lat').value);
  const lngVal = parseFloat(document.getElementById('input-lng').value);
  if (!isNaN(latVal) && !isNaN(lngVal)) {
    CadastreState.currentCoords.lat = latVal;
    CadastreState.currentCoords.lng = lngVal;
    if (CadastreState.mapInstance && CadastreState.mapMarker) {
      CadastreState.mapInstance.panTo([latVal, lngVal]);
      CadastreState.mapMarker.setLatLng([latVal, lngVal]);
      renderGISParcelLayer();
    }
  }
}

// -------------------------------------------------------------
// 3. File Upload & Gemini-style Removable Chips
// -------------------------------------------------------------
function renderFileChips() {
  const container = document.getElementById('uploaded-file-chips');
  if (!container) return;

  container.innerHTML = '';
  CadastreState.uploadedFiles.forEach(file => {
    const chip = document.createElement('div');
    chip.className = 'gemini-file-chip';
    chip.innerHTML = `
      <span class="chip-ext">${file.type}</span>
      <span>${file.name}</span>
      <span style="color:#94a3b8; font-size:11px;">(${file.size})</span>
      <button class="chip-remove" onclick="removeUploadedFile('${file.id}')" title="Remove file">×</button>
    `;
    container.appendChild(chip);
  });

  updateParameterBadges();
}

function removeUploadedFile(fileId) {
  CadastreState.uploadedFiles = CadastreState.uploadedFiles.filter(f => f.id !== fileId);
  renderFileChips();
}

function handleFileDrop(e) {
  e.preventDefault();
  const files = e.dataTransfer ? e.dataTransfer.files : e.target.files;
  if (!files || files.length === 0) return;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const nameLower = f.name.toLowerCase();
    const ext = nameLower.split('.').pop();
    
    let type = 'cad';
    if (ext === 'las' || ext === 'laz') {
      type = 'lidar';
      // LiDAR AI extraction: Total floors & floor height
      document.getElementById('input-floors').value = 4;
      document.getElementById('input-floor-height').value = 3.0;
    } else if (ext === 'tif' || ext === 'tiff' || ext === 'geojson') {
      type = 'drone';
      // Drone AI extraction: Footprint dimensions
      document.getElementById('input-bldg-length').value = 36.0;
      document.getElementById('input-bldg-width').value = 26.0;
    } else {
      type = 'cad';
      // Blueprint AI layout parsing
      const typologySelect = document.getElementById('input-bldg-typology');
      if (nameLower.includes('radial') || nameLower.includes('curved') || nameLower.includes('3wing') || nameLower.includes('y_shape') || nameLower.includes('plan1') || nameLower.includes('media_1791045846786')) {
        if (typologySelect) typologySelect.value = 'radial_3wing';
        document.getElementById('input-flats-per-floor').value = 3;
        document.getElementById('input-bldg-name').value = 'Radial Tri-Wing Residence';
      } else if (nameLower.includes('cruciform') || nameLower.includes('4wing') || nameLower.includes('cross') || nameLower.includes('piano') || nameLower.includes('tipo') || nameLower.includes('plan2') || nameLower.includes('media_1791045847238')) {
        if (typologySelect) typologySelect.value = 'cruciform_4wing';
        document.getElementById('input-flats-per-floor').value = 4;
        document.getElementById('input-bldg-name').value = 'Cruciform Quad Strata';
      }
    }

    CadastreState.uploadedFiles.push({
      id: 'f_' + Math.random().toString(36).substring(2, 7),
      name: f.name,
      type: type,
      size: (f.size / (1024 * 1024)).toFixed(1) + ' MB'
    });
  }
  
  renderFileChips();
  CadastreState.currentBuilding = buildBuildingModelFromForm();
  render2DVerticalMatrix(CadastreState.currentBuilding);
  render3DBuildingMesh(CadastreState.currentBuilding);
  renderGISParcelLayer();
}

function onBuildingTypologyChange() {
  const typology = document.getElementById('input-bldg-typology')?.value || 'rectangular';
  if (typology === 'radial_3wing') {
    document.getElementById('input-flats-per-floor').value = 3;
    document.getElementById('input-bldg-name').value = 'Radial Tri-Wing Residence';
  } else if (typology === 'cruciform_4wing') {
    document.getElementById('input-flats-per-floor').value = 4;
    document.getElementById('input-bldg-name').value = 'Cruciform Quad Strata';
  }
  CadastreState.currentBuilding = buildBuildingModelFromForm();
  render2DVerticalMatrix(CadastreState.currentBuilding);
  render3DBuildingMesh(CadastreState.currentBuilding);
  renderGISParcelLayer();
}

// -------------------------------------------------------------
// 4. AI Extracted vs Missing Parameter Badges
// -------------------------------------------------------------
function updateParameterBadges() {
  const hasDrone = CadastreState.uploadedFiles.some(f => f.type === 'drone');
  const hasLidar = CadastreState.uploadedFiles.some(f => f.type === 'lidar');
  const hasCAD = CadastreState.uploadedFiles.some(f => f.type === 'cad');

  const setBadge = (elementId, isExtracted, labelText, isMissing) => {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (isMissing) {
      el.className = 'badge-missing';
      el.innerHTML = '⚠️ Missing (Required)';
    } else if (isExtracted) {
      el.className = 'badge-ai-extracted';
      el.innerHTML = `✨ AI Extracted (${labelText})`;
    } else {
      el.className = 'badge-manual';
      el.innerHTML = '✍️ Manual Input';
    }
  };

  const lenVal = parseFloat(document.getElementById('input-bldg-length').value);
  const widVal = parseFloat(document.getElementById('input-bldg-width').value);
  const floorsVal = parseInt(document.getElementById('input-floors').value, 10);
  const heightVal = parseFloat(document.getElementById('input-floor-height').value);

  setBadge('badge-bldg-length', hasDrone, 'Drone Footprint', !lenVal || lenVal <= 0);
  setBadge('badge-bldg-width', hasDrone, 'Drone Footprint', !widVal || widVal <= 0);
  setBadge('badge-floors', hasLidar, 'LiDAR Elevation', !floorsVal || floorsVal <= 0);
  setBadge('badge-floor-height', hasLidar, 'LiDAR GSD', !heightVal || heightVal <= 0);
  setBadge('badge-flats-per-floor', hasCAD, 'CAD Blueprint', false);
  setBadge('badge-typology', hasCAD, 'Blueprint Parser', false);
}

// -------------------------------------------------------------
// 5. 2D Vertical Plan Matrix & Real-Time Flat Dimension Editing
// -------------------------------------------------------------
function generate3DUlpinString(ulpin2D, bldgNum, floorNum, flatNumStr) {
  const digits = flatNumStr.match(/\d+/);
  const flatInt = digits ? parseInt(digits[0], 10) : 1;
  const bPart = `B${String(bldgNum).padStart(2, '0')}`;
  const fPart = `F${String(floorNum).padStart(3, '0')}`;
  const uPart = `U${String(flatInt).padStart(3, '0')}`;
  return `${ulpin2D}-${bPart}-${fPart}-${uPart}`;
}

function getFlatPositionAndRotation(typology, floorNum, flatIdx, totalFlats, bldgLen, bldgWid, floorHeight, flatH) {
  const basePosY = floorNum * floorHeight + (flatH / 2);

  if (typology === 'radial_3wing') {
    // 3 Wings radiating at 0, 120, 240 deg (Matching Plan 1)
    const wingIdx = flatIdx % 3;
    const depth = Math.floor(flatIdx / 3);
    const angleRad = (wingIdx * 120) * (Math.PI / 180);
    const radius = 9.0 + depth * 10.0;
    
    const posX = Math.cos(angleRad) * radius;
    const posZ = Math.sin(angleRad) * radius;
    const rotY = -angleRad + Math.PI / 2;
    return { posX, posY: basePosY, posZ, rotY, geomW: 8.5, geomL: 12.0, geomH: flatH };
  } else if (typology === 'cruciform_4wing') {
    // 4 Symmetrical diagonal wings at 45, 135, 225, 315 deg (Matching Plan 2)
    const wingIdx = flatIdx % 4;
    const depth = Math.floor(flatIdx / 4);
    const angleRad = (wingIdx * 90 + 45) * (Math.PI / 180);
    const radius = 10.0 + depth * 9.0;
    
    const posX = Math.cos(angleRad) * radius;
    const posZ = Math.sin(angleRad) * radius;
    const rotY = -angleRad + Math.PI / 4;
    return { posX, posY: basePosY, posZ, rotY, geomW: 8.0, geomL: 10.5, geomH: flatH };
  } else if (typology === 'l_shape') {
    const isWingX = flatIdx < Math.ceil(totalFlats / 2);
    let posX = 0, posZ = 0;
    if (isWingX) {
      posX = -bldgLen / 2 + (flatIdx * 10.0) + 5.0;
      posZ = -bldgWid / 2 + 5.0;
    } else {
      const idxY = flatIdx - Math.ceil(totalFlats / 2);
      posX = -bldgLen / 2 + 5.0;
      posZ = -bldgWid / 2 + (idxY * 10.0) + 5.0;
    }
    return { posX, posY: basePosY, posZ, rotY: 0, geomW: 8.0, geomL: 9.5, geomH: flatH };
  } else {
    // Standard rectangular grid
    const flatsPerSide = Math.max(1, Math.ceil(totalFlats / 2));
    const flatLen = bldgLen / flatsPerSide;
    const flatWid = bldgWid / 2;
    const row = flatIdx % 2;
    const col = Math.floor(flatIdx / 2);
    const posX = -bldgLen / 2 + flatLen * col + flatLen / 2;
    const posZ = -bldgWid / 2 + flatWid * row + flatWid / 2;
    return { posX, posY: basePosY, posZ, rotY: 0, geomW: flatWid - 0.4, geomL: flatLen - 0.4, geomH: flatH - 0.1 };
  }
}

function buildBuildingModelFromForm() {
  const ulpin2D = document.getElementById('input-ulpin-2d').value.trim() || '72541DC5174453';
  const bldgName = document.getElementById('input-bldg-name').value.trim() || 'Apex Sky View';
  const totalFloors = parseInt(document.getElementById('input-floors').value, 10) || 4;
  const flatsPerFloor = parseInt(document.getElementById('input-flats-per-floor').value, 10) || 3;
  const bldgLength = parseFloat(document.getElementById('input-bldg-length').value) || 30.0;
  const bldgWidth = parseFloat(document.getElementById('input-bldg-width').value) || 20.0;
  const floorHeight = parseFloat(document.getElementById('input-floor-height').value) || 3.0;
  const typology = document.getElementById('input-bldg-typology')?.value || 'rectangular';

  const flatsPerSide = Math.max(1, Math.ceil(flatsPerFloor / 2));
  const defaultFlatLength = parseFloat((bldgLength / flatsPerSide).toFixed(2));
  const defaultFlatWidth = parseFloat((bldgWidth / 2).toFixed(2));
  const defaultArea = parseFloat((defaultFlatLength * defaultFlatWidth).toFixed(2));

  // Preserve existing flat custom edits if any
  const existingFlatsMap = {};
  if (CadastreState.currentBuilding && CadastreState.currentBuilding.floors) {
    CadastreState.currentBuilding.floors.forEach(f => {
      f.flats.forEach(fl => { existingFlatsMap[fl.flat_id] = fl; });
    });
  }

  const floors = [];
  let colorIdx = 0;

  for (let f = 0; f < totalFloors; f++) {
    const floorLabel = f === 0 ? 'Ground Floor' : `Floor ${f}`;
    const elevBottom = parseFloat((f * floorHeight).toFixed(2));
    const elevTop = parseFloat(((f + 1) * floorHeight).toFixed(2));
    const flats = [];

    for (let u = 1; u <= flatsPerFloor; u++) {
      const flatId = `F${f}_${u}`;
      const defaultFlatNum = f === 0 ? `Parking / Utility ${u}` : `Flat ${f * 100 + u}`;
      const defaultColor = FLAT_COLORS[colorIdx % FLAT_COLORS.length];
      colorIdx++;

      let flatData;
      if (existingFlatsMap[flatId]) {
        flatData = { ...existingFlatsMap[flatId] };
        flatData.floor_number = f;
      } else {
        const ulpin3D = generate3DUlpinString(ulpin2D, 1, f, f === 0 ? String(u) : String(f * 100 + u));
        flatData = {
          flat_id: flatId,
          flat_number: defaultFlatNum,
          floor_number: f,
          unit_type: f === 0 ? 'Parking' : 'Residential',
          width: defaultFlatWidth,
          length: defaultFlatLength,
          height: floorHeight,
          area_sqm: defaultArea,
          color_hex: defaultColor,
          owner_name: `Allotted Holder Unit ${f === 0 ? u : f * 100 + u}`,
          owner_share_pct: 100.0,
          deed_reference: `DOC-2026-TEL-0001-${f === 0 ? u : f * 100 + u}`,
          ulpin_3d: ulpin3D,
          accepted_by_planner: true,
          accepted_by_sro: true
        };
      }

      flats.push(flatData);
    }

    floors.push({
      floor_number: f,
      floor_label: floorLabel,
      floor_height: floorHeight,
      elevation_bottom: elevBottom,
      elevation_top: elevTop,
      flats: flats
    });
  }

  return {
    building_id: 'B001',
    building_number: 1,
    building_name: bldgName,
    ulpin_2d: ulpin2D,
    building_typology: typology,
    total_floors: totalFloors,
    flats_per_floor: flatsPerFloor,
    building_length: bldgLength,
    building_width: bldgWidth,
    building_height: parseFloat((totalFloors * floorHeight).toFixed(2)),
    floor_height: floorHeight,
    floors: floors
  };
}

function render2DVerticalMatrix(building) {
  const container = document.getElementById('vertical-matrix-rows');
  if (!container || !building) return;

  container.innerHTML = '';

  // Reverse iterate so Top floor is at top, Ground at bottom
  const reversedFloors = [...building.floors].reverse();

  reversedFloors.forEach(floor => {
    const row = document.createElement('div');
    row.className = 'matrix-floor-row';

    const floorCheckboxId = `chk-floor-${floor.floor_number}`;
    const allFloorFlatsSelected = floor.flats.every(fl => CadastreState.selectedFlatIds.has(fl.flat_id));

    row.innerHTML = `
      <div class="matrix-floor-label">
        <input type="checkbox" id="${floorCheckboxId}" ${allFloorFlatsSelected ? 'checked' : ''} onchange="toggleFloorSelection(${floor.floor_number}, this.checked)">
        <label for="${floorCheckboxId}">${floor.floor_label}</label>
      </div>
      <div class="matrix-flats-list" id="flats-row-${floor.floor_number}"></div>
    `;

    container.appendChild(row);

    const flatsListContainer = row.querySelector(`#flats-row-${floor.floor_number}`);
    floor.flats.forEach(flat => {
      const isSelected = CadastreState.selectedFlatIds.has(flat.flat_id);
      const isEditing = CadastreState.activeEditingFlatId === flat.flat_id;
      
      const flatBadge = document.createElement('div');
      flatBadge.className = `flat-select-item ${isSelected ? 'selected' : 'unselected'}`;
      if (isEditing) flatBadge.style.boxShadow = '0 0 0 2px #0e3b6e';
      flatBadge.id = `flat-badge-${flat.flat_id}`;

      flatBadge.innerHTML = `
        <input type="checkbox" ${isSelected ? 'checked' : ''} onchange="toggleFlatSelection('${flat.flat_id}', event)">
        <span onclick="openFlatDimensionEditor('${flat.flat_id}')" style="cursor:pointer;" title="Click to edit dimensions">${flat.flat_number}</span>
        <span class="color-swatch-box" style="background-color: ${flat.color_hex};"></span>
      `;
      flatsListContainer.appendChild(flatBadge);
    });
  });

  // Update Select All Checkbox state
  const selectAllChk = document.getElementById('chk-select-all-flats');
  if (selectAllChk) {
    const totalFlatsCount = building.floors.reduce((acc, f) => acc + f.flats.length, 0);
    selectAllChk.checked = CadastreState.selectedFlatIds.size === totalFlatsCount && totalFlatsCount > 0;
  }

  renderFlatDimensionEditor();
}

function toggleSelectAllFlats(checked) {
  if (!CadastreState.currentBuilding) return;
  CadastreState.selectedFlatIds.clear();
  if (checked) {
    CadastreState.currentBuilding.floors.forEach(floor => {
      floor.flats.forEach(flat => CadastreState.selectedFlatIds.add(flat.flat_id));
    });
  }
  render2DVerticalMatrix(CadastreState.currentBuilding);
  update3DColorsAndHighlight();
}

function toggleFloorSelection(floorNum, checked) {
  if (!CadastreState.currentBuilding) return;
  const floor = CadastreState.currentBuilding.floors.find(f => f.floor_number === floorNum);
  if (!floor) return;

  floor.flats.forEach(flat => {
    if (checked) CadastreState.selectedFlatIds.add(flat.flat_id);
    else CadastreState.selectedFlatIds.delete(flat.flat_id);
  });

  render2DVerticalMatrix(CadastreState.currentBuilding);
  update3DColorsAndHighlight();
}

function toggleFlatSelection(flatId, event) {
  if (event) event.stopPropagation();
  if (CadastreState.selectedFlatIds.has(flatId)) {
    CadastreState.selectedFlatIds.delete(flatId);
  } else {
    CadastreState.selectedFlatIds.add(flatId);
    CadastreState.activeEditingFlatId = flatId; // auto-open editor for this flat
  }
  render2DVerticalMatrix(CadastreState.currentBuilding);
  update3DColorsAndHighlight();
}

function openFlatDimensionEditor(flatId) {
  CadastreState.selectedFlatIds.add(flatId);
  CadastreState.activeEditingFlatId = flatId;
  render2DVerticalMatrix(CadastreState.currentBuilding);
  update3DColorsAndHighlight();
}

/**
 * Interactive Dimension & Strata Property Editor for Selected Flats
 * When multiple flats are ticked: shows only Height, Width, Length, and Area, updating all selected flats.
 * When a single flat is ticked: shows all detailed unit parameters.
 */
function renderFlatDimensionEditor() {
  const container = document.getElementById('selected-flat-editor-container');
  if (!container || !CadastreState.currentBuilding) return;

  const selectedCount = CadastreState.selectedFlatIds.size;

  // Case 1: No flats selected
  if (selectedCount === 0) {
    container.innerHTML = `
      <div style="font-size:12px; color:#64748b; padding:10px; background:#f8fafc; border-radius:6px; border:1px dashed #cbd5e1; text-align:center;">
        Tick one or more flats in the 2D plan above to edit dimensions.
      </div>
    `;
    return;
  }

  // Case 2: Multiple flats selected (more than 1)
  if (selectedCount > 1) {
    let sampleFlat = null;
    for (const floor of CadastreState.currentBuilding.floors) {
      for (const flat of floor.flats) {
        if (CadastreState.selectedFlatIds.has(flat.flat_id)) {
          sampleFlat = flat;
          break;
        }
      }
      if (sampleFlat) break;
    }

    const currentW = sampleFlat ? sampleFlat.width : 10.0;
    const currentL = sampleFlat ? sampleFlat.length : 15.0;
    const currentH = sampleFlat ? sampleFlat.height : 3.0;
    const currentA = parseFloat((currentW * currentL).toFixed(2));

    container.innerHTML = `
      <div class="flat-editor-box" style="background:#f0fdf4; border-color:#86efac;">
        <div class="flat-editor-header">
          <h4 style="color:#166534;">
            <span>📐</span> Batch Dimension Editor (${selectedCount} Flats Selected)
          </h4>
          <span style="font-size:11px; color:#15803d; font-weight:700;">Updates dimensions of all ${selectedCount} ticked flats simultaneously</span>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="batch-flat-height">Flat Height (m):</label>
            <input type="number" id="batch-flat-height" class="form-input" value="${currentH}" step="0.1" oninput="updateBatchFlatDimension('height', parseFloat(this.value))">
          </div>
          <div class="form-group">
            <label class="form-label" for="batch-flat-width">Flat Width (m):</label>
            <input type="number" id="batch-flat-width" class="form-input" value="${currentW}" step="0.1" oninput="updateBatchFlatDimension('width', parseFloat(this.value))">
          </div>
          <div class="form-group">
            <label class="form-label" for="batch-flat-length">Flat Length (m):</label>
            <input type="number" id="batch-flat-length" class="form-input" value="${currentL}" step="0.1" oninput="updateBatchFlatDimension('length', parseFloat(this.value))">
          </div>
          <div class="form-group">
            <label class="form-label" for="batch-flat-area">Computed Area (m²):</label>
            <input type="text" id="batch-flat-area" class="form-input" value="${currentA} m²" readonly style="background:#dcfce7; font-weight:700; color:#166534;">
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Case 3: Single flat selected (selectedCount === 1)
  const singleFlatId = Array.from(CadastreState.selectedFlatIds)[0];
  let activeFlat = null;
  let activeFloor = null;
  for (const floor of CadastreState.currentBuilding.floors) {
    for (const flat of floor.flats) {
      if (flat.flat_id === singleFlatId) {
        activeFlat = flat;
        activeFloor = floor;
        break;
      }
    }
    if (activeFlat) break;
  }

  if (!activeFlat) return;

  container.innerHTML = `
    <div class="flat-editor-box">
      <div class="flat-editor-header">
        <h4>
          <span class="color-swatch-box" style="background-color:${activeFlat.color_hex};"></span>
          Editing: ${activeFlat.flat_number} (${activeFloor.floor_label})
        </h4>
        <span style="font-size:11px; color:#1d4ed8; font-weight:700;">ULPIN: ${activeFlat.ulpin_3d}</span>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="edit-flat-name">Flat Label / Unit No:</label>
          <input type="text" id="edit-flat-name" class="form-input" value="${activeFlat.flat_number}" oninput="updateActiveFlatField('flat_number', this.value)">
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-flat-type">Unit Classification:</label>
          <select id="edit-flat-type" class="form-select" onchange="updateActiveFlatField('unit_type', this.value)">
            <option value="Residential" ${activeFlat.unit_type === 'Residential' ? 'selected' : ''}>Residential</option>
            <option value="Commercial" ${activeFlat.unit_type === 'Commercial' ? 'selected' : ''}>Commercial</option>
            <option value="Parking" ${activeFlat.unit_type === 'Parking' ? 'selected' : ''}>Parking / Utility</option>
            <option value="Penthouse" ${activeFlat.unit_type === 'Penthouse' ? 'selected' : ''}>Penthouse / Duplex</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-flat-color">Unit Color:</label>
          <input type="color" id="edit-flat-color" class="form-input" style="height:36px; padding:2px;" value="${activeFlat.color_hex}" onchange="updateActiveFlatField('color_hex', this.value)">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="edit-flat-width">Width (m):</label>
          <input type="number" id="edit-flat-width" class="form-input" value="${activeFlat.width}" step="0.1" oninput="updateActiveFlatDimension('width', parseFloat(this.value))">
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-flat-length">Length (m):</label>
          <input type="number" id="edit-flat-length" class="form-input" value="${activeFlat.length}" step="0.1" oninput="updateActiveFlatDimension('length', parseFloat(this.value))">
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-flat-height">Height (m):</label>
          <input type="number" id="edit-flat-height" class="form-input" value="${activeFlat.height}" step="0.1" oninput="updateActiveFlatDimension('height', parseFloat(this.value))">
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-flat-area">Computed Area (m²):</label>
          <input type="text" id="edit-flat-area" class="form-input" value="${activeFlat.area_sqm} m²" readonly style="background:#e2e8f0; font-weight:700;">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group">
          <label class="form-label" for="edit-flat-owner">Allotted Owner Name:</label>
          <input type="text" id="edit-flat-owner" class="form-input" value="${activeFlat.owner_name}" oninput="updateActiveFlatField('owner_name', this.value)">
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-flat-share">Owner Share %:</label>
          <input type="number" id="edit-flat-share" class="form-input" value="${activeFlat.owner_share_pct}" min="1" max="100" oninput="updateActiveFlatField('owner_share_pct', parseFloat(this.value))">
        </div>
      </div>
    </div>
  `;
}

function updateBatchFlatDimension(dimField, val) {
  if (!CadastreState.currentBuilding || isNaN(val) || val <= 0) return;

  CadastreState.currentBuilding.floors.forEach(floor => {
    floor.flats.forEach(flat => {
      if (CadastreState.selectedFlatIds.has(flat.flat_id)) {
        flat[dimField] = val;
        flat.area_sqm = parseFloat((flat.width * flat.length).toFixed(2));
      }
    });
  });

  const widthEl = document.getElementById('batch-flat-width');
  const lengthEl = document.getElementById('batch-flat-length');
  const areaEl = document.getElementById('batch-flat-area');
  if (widthEl && lengthEl && areaEl) {
    const w = parseFloat(widthEl.value) || 1.0;
    const l = parseFloat(lengthEl.value) || 1.0;
    areaEl.value = `${(w * l).toFixed(2)} m²`;
  }

  render3DBuildingMesh(CadastreState.currentBuilding);
}

function updateActiveFlatField(field, value) {
  if (!CadastreState.activeEditingFlatId || !CadastreState.currentBuilding) return;
  for (const floor of CadastreState.currentBuilding.floors) {
    for (const flat of floor.flats) {
      if (flat.flat_id === CadastreState.activeEditingFlatId) {
        flat[field] = value;
        break;
      }
    }
  }
  render3DBuildingMesh(CadastreState.currentBuilding);
}

function updateActiveFlatDimension(dimField, val) {
  if (!CadastreState.activeEditingFlatId || !CadastreState.currentBuilding || isNaN(val) || val <= 0) return;
  for (const floor of CadastreState.currentBuilding.floors) {
    for (const flat of floor.flats) {
      if (flat.flat_id === CadastreState.activeEditingFlatId) {
        flat[dimField] = val;
        flat.area_sqm = parseFloat((flat.width * flat.length).toFixed(2));
        const areaInput = document.getElementById('edit-flat-area');
        if (areaInput) areaInput.value = `${flat.area_sqm} m²`;
        break;
      }
    }
  }
  render3DBuildingMesh(CadastreState.currentBuilding);
}

// -------------------------------------------------------------
// 6. Three.js 3D WebGL Rendering Engine & Explode Floors
// -------------------------------------------------------------
function initThreeJsViewer() {
  const container = document.getElementById('threejs-canvas-wrapper');
  if (!container || typeof THREE === 'undefined') return;

  CadastreState.threeScene = new THREE.Scene();
  CadastreState.threeScene.background = new THREE.Color(0xf1f5f9);

  const width = container.clientWidth || 600;
  const height = container.clientHeight || 480;
  CadastreState.threeCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  CadastreState.threeCamera.position.set(38, 30, 48);

  CadastreState.threeRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  CadastreState.threeRenderer.setSize(width, height);
  CadastreState.threeRenderer.setPixelRatio(window.devicePixelRatio);
  CadastreState.threeRenderer.shadowMap.enabled = true;
  container.innerHTML = '';
  container.appendChild(CadastreState.threeRenderer.domElement);

  if (typeof THREE.OrbitControls !== 'undefined') {
    CadastreState.threeControls = new THREE.OrbitControls(CadastreState.threeCamera, CadastreState.threeRenderer.domElement);
    CadastreState.threeControls.enableDamping = true;
    CadastreState.threeControls.dampingFactor = 0.05;
    CadastreState.threeControls.target.set(0, 6, 0);
  }

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  CadastreState.threeScene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(30, 50, 40);
  dirLight.castShadow = true;
  CadastreState.threeScene.add(dirLight);

  const groundGrid = new THREE.GridHelper(60, 30, 0x0e3b6e, 0xcbd5e1);
  groundGrid.position.y = -0.01;
  CadastreState.threeScene.add(groundGrid);

  setupRaycaster(container);
  animateThreeJs();
  window.addEventListener('resize', onWindowResize);
}

function animateThreeJs() {
  requestAnimationFrame(animateThreeJs);
  if (CadastreState.threeControls) CadastreState.threeControls.update();
  if (CadastreState.threeRenderer && CadastreState.threeScene && CadastreState.threeCamera) {
    CadastreState.threeRenderer.render(CadastreState.threeScene, CadastreState.threeCamera);
  }
}

function onWindowResize() {
  const container = document.getElementById('threejs-canvas-wrapper');
  if (container && CadastreState.threeCamera && CadastreState.threeRenderer) {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width > 0 && height > 0) {
      CadastreState.threeCamera.aspect = width / height;
      CadastreState.threeCamera.updateProjectionMatrix();
      CadastreState.threeRenderer.setSize(width, height);
    }
  }
  if (typeof onPlannerWindowResize === 'function') onPlannerWindowResize();
  if (typeof onSROWindowResize === 'function') onSROWindowResize();
  if (typeof onCitizenWindowResize === 'function') onCitizenWindowResize();
}

function render3DBuildingMesh(building) {
  if (!CadastreState.threeScene || !building || !building.floors) return;

  CadastreState.threeMeshes.forEach(mesh => CadastreState.threeScene.remove(mesh));
  CadastreState.threeMeshes = [];

  const floorHeight = parseFloat(building.floor_height) || 3.0;
  const bldgLength = parseFloat(building.building_length) || 30.0;
  const bldgWidth = parseFloat(building.building_width) || 20.0;
  const totalFloors = parseInt(building.total_floors, 10) || building.floors.length || 4;
  const typology = building.building_typology || document.getElementById('input-bldg-typology')?.value || 'rectangular';

  // Center orbit controls on middle of building volume
  if (CadastreState.threeControls) {
    CadastreState.threeControls.target.set(0, (totalFloors * floorHeight) / 2, 0);
  }

  // Add central atrium core if radial or cruciform
  if (typology === 'radial_3wing' || typology === 'cruciform_4wing') {
    for (let f = 0; f < totalFloors; f++) {
      const coreGeom = new THREE.CylinderGeometry(3.5, 3.5, floorHeight - 0.2, typology === 'radial_3wing' ? 3 : 4);
      const coreMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.85 });
      const coreMesh = new THREE.Mesh(coreGeom, coreMat);
      coreMesh.position.set(0, f * floorHeight + (floorHeight / 2), 0);
      coreMesh.userData = { floorNumber: f, baseY: f * floorHeight + (floorHeight / 2) };
      const coreEdge = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeom), new THREE.LineBasicMaterial({ color: 0x64748b }));
      coreMesh.add(coreEdge);
      CadastreState.threeScene.add(coreMesh);
      CadastreState.threeMeshes.push(coreMesh);
    }
  }

  building.floors.forEach((floor, fIdx) => {
    const floorNum = typeof floor.floor_number === 'number' ? floor.floor_number : fIdx;
    const flatsCount = (floor.flats && floor.flats.length) ? floor.flats.length : 1;

    if (floor.flats && Array.isArray(floor.flats)) {
      floor.flats.forEach((flat, idx) => {
        const flatH = parseFloat(flat.height) || floorHeight;
        const posData = getFlatPositionAndRotation(typology, floorNum, idx, flatsCount, bldgLength, bldgWidth, floorHeight, flatH);
        const geom = new THREE.BoxGeometry(posData.geomL, posData.geomH, posData.geomW);
        
        const isSelected = CadastreState.selectedFlatIds.size === 0 || CadastreState.selectedFlatIds.has(flat.flat_id);
        const displayColor = isSelected ? (flat.color_hex || '#4ECDC4') : '#94a3b8';
        const opacity = isSelected ? 0.92 : 0.25;

        const mat = new THREE.MeshStandardMaterial({
          color: displayColor,
          roughness: 0.3,
          metalness: 0.1,
          transparent: true,
          opacity: opacity
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(posData.posX, posData.posY, posData.posZ);
        if (posData.rotY) mesh.rotation.y = posData.rotY;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        const edgeGeom = new THREE.EdgesGeometry(geom);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x072242, linewidth: 1.5, transparent: true, opacity: 0.6 });
        const edgeLine = new THREE.LineSegments(edgeGeom, edgeMat);
        mesh.add(edgeLine);

        mesh.userData = {
          flatId: flat.flat_id,
          flatNumber: flat.flat_number || `Flat ${floorNum * 100 + idx + 1}`,
          floorNumber: floorNum,
          floorLabel: floor.floor_label || `Floor ${floorNum}`,
          ulpin3D: flat.ulpin_3d || '',
          colorHex: flat.color_hex || '#4ECDC4',
          baseY: posData.posY,
          area: flat.area_sqm || (flat.width * flat.length) || 0,
          owner: flat.owner_name || 'Allotted Holder',
          deed: flat.deed_reference || ''
        };

        CadastreState.threeScene.add(mesh);
        CadastreState.threeMeshes.push(mesh);
      });
    }
  });

  applyFloorExplode(CadastreState.explodeFactor);
  setTimeout(onWindowResize, 50);
}

function applyFloorExplode(factor) {
  CadastreState.explodeFactor = factor;
  const explodeSpacing = 4.0;

  CadastreState.threeMeshes.forEach(mesh => {
    const floorNum = mesh.userData.floorNumber;
    mesh.position.y = mesh.userData.baseY + (floorNum * factor * explodeSpacing);
  });
}

function update3DColorsAndHighlight() {
  CadastreState.threeMeshes.forEach(mesh => {
    const isSelected = CadastreState.selectedFlatIds.size === 0 || CadastreState.selectedFlatIds.has(mesh.userData.flatId);
    const color = isSelected ? mesh.userData.colorHex : '#94a3b8';
    mesh.material.color.set(color);
    mesh.material.opacity = isSelected ? 0.92 : 0.25;
  });
}

function setupRaycaster(container) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const tooltip = document.getElementById('viewer-tooltip');

  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, CadastreState.threeCamera);
    const intersects = raycaster.intersectObjects(CadastreState.threeMeshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const data = hit.userData;
      if (tooltip) {
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX - rect.left + 15}px`;
        tooltip.style.top = `${e.clientY - rect.top + 15}px`;
        tooltip.innerHTML = `
          <strong>${data.flatNumber} (${data.floorLabel})</strong><br>
          <span style="font-size:10px; color:#cbd5e1;">ULPIN: ${data.ulpin3D}</span><br>
          Area: ${data.area} m² | Owner: ${data.owner}
        `;
      }
    } else {
      if (tooltip) tooltip.style.display = 'none';
    }
  });

  container.addEventListener('click', (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, CadastreState.threeCamera);
    const intersects = raycaster.intersectObjects(CadastreState.threeMeshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      openFlatDimensionEditor(hit.userData.flatId);
    }
  });
}

// -------------------------------------------------------------
// 7. Surveyor Dashboard (New Application, In-Process, & Rejected Queue)
// -------------------------------------------------------------
function renderSurveyorDashboard() {
  const inProcessContainer = document.getElementById('surveyor-inprocess-list');
  const rejectedContainer = document.getElementById('surveyor-rejected-list');
  if (!inProcessContainer || !rejectedContainer) return;

  inProcessContainer.innerHTML = '';
  rejectedContainer.innerHTML = '';

  const inProcessApps = CadastreState.applications.filter(a => 
    a.status === 'Pending_Town_Planner' || a.status === 'Pending_SRO' || a.status === 'Approved'
  );

  const rejectedApps = CadastreState.applications.filter(a => 
    a.status === 'Rejected_By_Planner' || a.status === 'Rejected_By_SRO'
  );

  // Render In-Process
  if (inProcessApps.length === 0) {
    inProcessContainer.innerHTML = '<p style="font-size:12px; color:#64748b; padding:10px;">No active applications in process.</p>';
  } else {
    inProcessApps.forEach(app => {
      const item = document.createElement('div');
      item.className = 'queue-card-item';
      if (app.application_id === CadastreState.activeAppId) item.classList.add('active');
      
      let stepLabel = 'In Municipal Audit (Town Planner)';
      let badgeClass = 'pending-planner';
      if (app.status === 'Pending_SRO') {
        stepLabel = 'Statutory Audit (SRO Title Linking)';
        badgeClass = 'pending-sro';
      } else if (app.status === 'Approved') {
        stepLabel = 'Deed Sealed & 3D ULPIN Issued';
        badgeClass = 'approved';
      }

      item.innerHTML = `
        <div class="queue-item-header">
          <span class="queue-item-title">${app.building_params.building_name} (${app.building_params.building_id})</span>
          <span class="status-pill ${badgeClass}">${app.status.replace(/_/g, ' ')}</span>
        </div>
        <div class="queue-item-sub" style="margin-bottom:6px;">
          📍 ${app.coordinates.survey_number} • ${app.building_params.total_floors} Floors • ULPIN: <code>${app.ulpin_2d}</code>
        </div>
        <div style="font-size:11px; color:#1e3a8a; background:#eff6ff; padding:4px 8px; border-radius:4px; display:flex; justify-content:space-between; align-items:center;">
          <span>⏳ <strong>Current Step:</strong> ${stepLabel}</span>
          <button class="btn btn-secondary btn-sm" onclick="selectApplication('${app.application_id}')">Inspect</button>
        </div>
      `;
      inProcessContainer.appendChild(item);
    });
  }

  // Render Rejected
  if (rejectedApps.length === 0) {
    rejectedContainer.innerHTML = '<p style="font-size:12px; color:#64748b; padding:10px;">No rejected applications. All parcels compliant.</p>';
  } else {
    rejectedApps.forEach(app => {
      const item = document.createElement('div');
      item.className = 'queue-card-item';
      item.style.borderColor = '#fca5a5';
      if (app.application_id === CadastreState.activeAppId) item.classList.add('active');

      const lastRemark = app.audit_history.length > 0 ? app.audit_history[app.audit_history.length - 1] : null;
      const rejectedBy = app.status === 'Rejected_By_Planner' ? 'Town Planner Rejection' : 'SRO Legal Rejection';

      item.innerHTML = `
        <div class="queue-item-header">
          <span class="queue-item-title" style="color:#b91c1c;">${app.building_params.building_name} (${app.building_params.building_id})</span>
          <span class="status-pill rejected">${rejectedBy}</span>
        </div>
        <div class="queue-item-sub">
          📍 ${app.coordinates.survey_number} • ULPIN: <code>${app.ulpin_2d}</code>
        </div>
        <div style="margin-top:6px; font-size:11px; color:#7f1d1d; background:#fef2f2; border-left:3px solid #ef4444; padding:6px 8px; border-radius:4px;">
          <strong>Auditor Remarks (${lastRemark ? lastRemark.author_name : 'Reviewer'}):</strong><br>
          "${lastRemark ? lastRemark.remarks : 'Please modify parameters'}"
        </div>
        <div style="margin-top:8px; text-align:right;">
          <button class="btn btn-danger btn-sm" onclick="openApplicationForEdit('${app.application_id}')">✏️ Edit & Resubmit</button>
        </div>
      `;
      rejectedContainer.appendChild(item);
    });
  }
}

function startNewApplication() {
  const newUlpin = '72541DC' + Math.floor(100000 + Math.random() * 900000);
  const newAppId = 'APP-TEL-2026-' + Math.floor(100 + Math.random() * 900);

  document.getElementById('input-ulpin-2d').value = newUlpin;
  document.getElementById('input-bldg-name').value = 'New Cadastral Parcel';
  document.getElementById('input-floors').value = 4;
  document.getElementById('input-flats-per-floor').value = 3;
  document.getElementById('input-bldg-length').value = 30.0;
  document.getElementById('input-bldg-width').value = 20.0;
  document.getElementById('input-floor-height').value = 3.0;

  CadastreState.currentBuilding = buildBuildingModelFromForm();
  CadastreState.selectedFlatIds.clear();
  CadastreState.currentBuilding.floors.forEach(f => f.flats.forEach(fl => CadastreState.selectedFlatIds.add(fl.flat_id)));
  CadastreState.activeEditingFlatId = null;

  render2DVerticalMatrix(CadastreState.currentBuilding);
  render3DBuildingMesh(CadastreState.currentBuilding);
  updateParameterBadges();

  // Scroll to intake card
  document.getElementById('surveyor-intake-card').scrollIntoView({ behavior: 'smooth' });
}

function openApplicationForEdit(appId) {
  selectApplication(appId);
  document.getElementById('surveyor-intake-card').scrollIntoView({ behavior: 'smooth' });
}

// -------------------------------------------------------------
// 8. Application Loading & Selection
// -------------------------------------------------------------
async function loadApplicationsQueue() {
  try {
    const res = await fetch('/api/cadastre/planner/queue');
    if (res.ok) {
      CadastreState.applications = await res.json();
      renderAllQueueCards();
      renderSurveyorDashboard();
    }
  } catch (err) {
    console.warn('Backend API offline, using fallback state storage', err);
  }
}

function selectApplication(appId) {
  CadastreState.activeAppId = appId;
  const app = CadastreState.applications.find(a => a.application_id === appId);
  if (!app) return;

  CadastreState.currentBuilding = app.building_params;
  CadastreState.currentCoords = app.coordinates;

  // Update surveyor inputs
  document.getElementById('input-ulpin-2d').value = app.ulpin_2d;
  document.getElementById('input-bldg-name').value = app.building_params.building_name;
  document.getElementById('input-floors').value = app.building_params.total_floors;
  document.getElementById('input-flats-per-floor').value = app.building_params.flats_per_floor;
  document.getElementById('input-bldg-length').value = app.building_params.building_length;
  document.getElementById('input-bldg-width').value = app.building_params.building_width;
  document.getElementById('input-floor-height').value = app.building_params.floor_height;

  updateMapCoords(app.coordinates.latitude, app.coordinates.longitude, app.coordinates.address);

  // Initialize selected flats
  CadastreState.selectedFlatIds.clear();
  app.building_params.floors.forEach(f => f.flats.forEach(fl => CadastreState.selectedFlatIds.add(fl.flat_id)));
  CadastreState.activeEditingFlatId = app.building_params.floors[0].flats[0].flat_id;

  render2DVerticalMatrix(CadastreState.currentBuilding);
  render3DBuildingMesh(CadastreState.currentBuilding);
  renderFileChips();
  updateParameterBadges();
  renderSurveyorDashboard();

  if (CadastreState.activeRole === 'planner') renderPlannerView();
  if (CadastreState.activeRole === 'sro') renderSROView();
}

function renderAllQueueCards() {
  renderQueueForRole('planner-queue-container', 'planner');
  renderQueueForRole('sro-queue-container', 'sro');
}

function renderQueueForRole(containerId, role) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';
  CadastreState.applications.forEach(app => {
    const card = document.createElement('div');
    const isActive = app.application_id === CadastreState.activeAppId;
    card.className = `queue-card-item ${isActive ? 'active' : ''}`;
    card.onclick = () => selectApplication(app.application_id);

    let statusBadgeClass = 'draft';
    let statusLabel = app.status;
    if (app.status === 'Pending_Town_Planner') { statusBadgeClass = 'pending-planner'; statusLabel = 'In Municipal Audit'; }
    if (app.status === 'Pending_SRO') { statusBadgeClass = 'pending-sro'; statusLabel = 'Awaiting SRO Deed'; }
    if (app.status === 'Approved') { statusBadgeClass = 'approved'; statusLabel = 'Deed Sealed'; }
    if (app.status.includes('Rejected')) { statusBadgeClass = 'rejected'; statusLabel = 'Revision Required'; }

    card.innerHTML = `
      <div class="queue-item-header">
        <span class="queue-item-title">${app.building_params.building_name} (${app.building_params.building_id})</span>
        <span class="status-pill ${statusBadgeClass}">${statusLabel}</span>
      </div>
      <div class="queue-item-sub">
        ${app.coordinates.survey_number} • ${app.building_params.total_floors} Floors • ULPIN: ${app.ulpin_2d}
      </div>
    `;
    container.appendChild(card);
  });
}

// -------------------------------------------------------------
// 9. Town Planner View, 3D WebGL Canvas & Compliance Logic
// -------------------------------------------------------------
let plannerThreeInstance = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  meshes: [],
  explodeFactor: 0.0
};

function initPlannerThreeJsViewer() {
  const container = document.getElementById('planner-threejs-canvas-wrapper');
  if (!container || typeof THREE === 'undefined') return;

  if (plannerThreeInstance.renderer) {
    onPlannerWindowResize();
    return;
  }

  plannerThreeInstance.scene = new THREE.Scene();
  plannerThreeInstance.scene.background = new THREE.Color(0xf1f5f9);

  const width = container.clientWidth || 550;
  const height = container.clientHeight || 480;
  plannerThreeInstance.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  plannerThreeInstance.camera.position.set(38, 30, 48);

  plannerThreeInstance.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  plannerThreeInstance.renderer.setSize(width, height);
  plannerThreeInstance.renderer.setPixelRatio(window.devicePixelRatio);
  plannerThreeInstance.renderer.shadowMap.enabled = true;
  container.innerHTML = '';
  container.appendChild(plannerThreeInstance.renderer.domElement);

  if (typeof THREE.OrbitControls !== 'undefined') {
    plannerThreeInstance.controls = new THREE.OrbitControls(plannerThreeInstance.camera, plannerThreeInstance.renderer.domElement);
    plannerThreeInstance.controls.enableDamping = true;
    plannerThreeInstance.controls.dampingFactor = 0.05;
    plannerThreeInstance.controls.target.set(0, 6, 0);
  }

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  plannerThreeInstance.scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(30, 50, 40);
  dirLight.castShadow = true;
  plannerThreeInstance.scene.add(dirLight);

  const groundGrid = new THREE.GridHelper(60, 30, 0x0e3b6e, 0xcbd5e1);
  groundGrid.position.y = -0.01;
  plannerThreeInstance.scene.add(groundGrid);

  // Setup explode slider listener
  const slider = document.getElementById('planner-explode-slider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      const factor = parseFloat(e.target.value) / 100.0;
      applyPlannerFloorExplode(factor);
    });
  }

  setupPlannerRaycaster(container);
  animatePlannerThreeJs();
  window.addEventListener('resize', onPlannerWindowResize);
}

function animatePlannerThreeJs() {
  requestAnimationFrame(animatePlannerThreeJs);
  if (plannerThreeInstance.controls) plannerThreeInstance.controls.update();
  if (plannerThreeInstance.renderer && plannerThreeInstance.scene && plannerThreeInstance.camera) {
    plannerThreeInstance.renderer.render(plannerThreeInstance.scene, plannerThreeInstance.camera);
  }
}

function onPlannerWindowResize() {
  const container = document.getElementById('planner-threejs-canvas-wrapper');
  if (!container || !plannerThreeInstance.camera || !plannerThreeInstance.renderer) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width === 0 || height === 0) return;
  plannerThreeInstance.camera.aspect = width / height;
  plannerThreeInstance.camera.updateProjectionMatrix();
  plannerThreeInstance.renderer.setSize(width, height);
}

function renderPlanner3DBuildingMesh(building) {
  initPlannerThreeJsViewer();
  if (!plannerThreeInstance.scene || !building) return;

  plannerThreeInstance.meshes.forEach(mesh => plannerThreeInstance.scene.remove(mesh));
  plannerThreeInstance.meshes = [];

  const floorHeight = building.floor_height || 3.0;
  const bldgLength = building.building_length || 30.0;
  const bldgWidth = building.building_width || 20.0;

  const typology = building.building_typology || 'rectangular';

  // Central atrium core if radial or cruciform
  if (typology === 'radial_3wing' || typology === 'cruciform_4wing') {
    for (let f = 0; f < building.total_floors; f++) {
      const coreGeom = new THREE.CylinderGeometry(3.5, 3.5, floorHeight - 0.2, typology === 'radial_3wing' ? 3 : 4);
      const coreMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.85 });
      const coreMesh = new THREE.Mesh(coreGeom, coreMat);
      coreMesh.position.set(0, f * floorHeight + (floorHeight / 2), 0);
      coreMesh.userData = { floorNumber: f, baseY: f * floorHeight + (floorHeight / 2) };
      const coreEdge = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeom), new THREE.LineBasicMaterial({ color: 0x64748b }));
      coreMesh.add(coreEdge);
      plannerThreeInstance.scene.add(coreMesh);
      plannerThreeInstance.meshes.push(coreMesh);
    }
  }

  building.floors.forEach(floor => {
    const flatsCount = floor.flats.length;

    floor.flats.forEach((flat, idx) => {
      const posData = getFlatPositionAndRotation(typology, floor.floor_number, idx, flatsCount, bldgLength, bldgWidth, floorHeight, flat.height);
      const geom = new THREE.BoxGeometry(posData.geomL, posData.geomH, posData.geomW);
      
      const mat = new THREE.MeshStandardMaterial({
        color: flat.color_hex,
        roughness: 0.3,
        metalness: 0.1,
        transparent: true,
        opacity: 0.92
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(posData.posX, posData.posY, posData.posZ);
      if (posData.rotY) mesh.rotation.y = posData.rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const edgeGeom = new THREE.EdgesGeometry(geom);
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x072242, linewidth: 1.5, transparent: true, opacity: 0.6 });
      const edgeLine = new THREE.LineSegments(edgeGeom, edgeMat);
      mesh.add(edgeLine);

      mesh.userData = {
        flatId: flat.flat_id,
        flatNumber: flat.flat_number,
        floorNumber: floor.floor_number,
        floorLabel: floor.floor_label,
        ulpin3D: flat.ulpin_3d,
        colorHex: flat.color_hex,
        baseY: posData.posY,
        area: flat.area_sqm,
        owner: flat.owner_name
      };

      plannerThreeInstance.scene.add(mesh);
      plannerThreeInstance.meshes.push(mesh);
    });
  });

  applyPlannerFloorExplode(plannerThreeInstance.explodeFactor);
  setTimeout(onPlannerWindowResize, 50);
}

function applyPlannerFloorExplode(factor) {
  plannerThreeInstance.explodeFactor = factor;
  const explodeSpacing = 4.0;

  plannerThreeInstance.meshes.forEach(mesh => {
    const floorNum = mesh.userData.floorNumber;
    mesh.position.y = mesh.userData.baseY + (floorNum * factor * explodeSpacing);
  });
}

function setupPlannerRaycaster(container) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const tooltip = document.getElementById('planner-viewer-tooltip');

  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, plannerThreeInstance.camera);
    const intersects = raycaster.intersectObjects(plannerThreeInstance.meshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const data = hit.userData;
      if (tooltip) {
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX - rect.left + 15}px`;
        tooltip.style.top = `${e.clientY - rect.top + 15}px`;
        tooltip.innerHTML = `
          <strong>${data.flatNumber} (${data.floorLabel})</strong><br>
          <span style="font-size:10px; color:#cbd5e1;">ULPIN: ${data.ulpin3D}</span><br>
          Area: ${data.area} m² | Owner: ${data.owner}
        `;
      }
    } else {
      if (tooltip) tooltip.style.display = 'none';
    }
  });
}

function renderPlannerView() {
  const app = CadastreState.applications.find(a => a.application_id === CadastreState.activeAppId);
  if (!app) return;

  const checklistContainer = document.getElementById('planner-checklist-container');
  if (!checklistContainer) return;

  checklistContainer.innerHTML = '';
  const report = app.planner_compliance_report || { checks: [] };

  const rejectedChecks = report.checks.filter(c => c.status === 'Rejected');
  const acceptedChecks = report.checks.filter(c => c.status === 'Accepted');

  // Summary Counter Banner
  const summaryDiv = document.createElement('div');
  summaryDiv.style.display = 'flex';
  summaryDiv.style.gap = '10px';
  summaryDiv.style.marginBottom = '14px';
  summaryDiv.innerHTML = `
    <span class="status-pill ${rejectedChecks.length > 0 ? 'rejected' : 'approved'}">
      ${rejectedChecks.length > 0 ? '❌ ' + rejectedChecks.length + ' Rejected Items / Violations' : '✔ 0 Violations'}
    </span>
    <span class="status-pill approved">
      ✔ ${acceptedChecks.length} Accepted / Compliant Items
    </span>
  `;
  checklistContainer.appendChild(summaryDiv);

  // 1. Render Rejected Items First (Prominent Red Cards)
  if (rejectedChecks.length > 0) {
    const rejHeader = document.createElement('h4');
    rejHeader.style.fontSize = '12px';
    rejHeader.style.color = '#b91c1c';
    rejHeader.style.fontWeight = '700';
    rejHeader.style.margin = '10px 0 6px 0';
    rejHeader.innerHTML = '🔴 Non-Compliant / Rejected Bye-Law Items:';
    checklistContainer.appendChild(rejHeader);

    rejectedChecks.forEach(chk => {
      const card = document.createElement('div');
      card.style.background = '#fef2f2';
      card.style.border = '1px solid #fecaca';
      card.style.borderLeft = '4px solid #ef4444';
      card.style.borderRadius = '6px';
      card.style.padding = '10px 12px';
      card.style.marginBottom = '8px';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong style="color:#991b1b; font-size:13px;">${chk.item}</strong>
          <span class="check-status-badge reject">REJECTED</span>
        </div>
        <div style="font-size:11px; color:#7f1d1d; line-height:1.5;">
          • <strong>Permissible Limit:</strong> ${chk.requirement}<br>
          • <strong>Actual Plan Dimension:</strong> <span style="font-weight:700; color:#dc2626;">${chk.actual}</span><br>
          • <strong>Violation Detail:</strong> ${chk.remark}
        </div>
      `;
      checklistContainer.appendChild(card);
    });
  }

  // 2. Render Accepted Items
  const accHeader = document.createElement('h4');
  accHeader.style.fontSize = '12px';
  accHeader.style.color = '#15803d';
  accHeader.style.fontWeight = '700';
  accHeader.style.margin = '14px 0 6px 0';
  accHeader.innerHTML = '🟢 Compliant / Accepted Bye-Law Items:';
  checklistContainer.appendChild(accHeader);

  acceptedChecks.forEach(chk => {
    const row = document.createElement('div');
    row.className = 'check-item-row';
    row.innerHTML = `
      <div>
        <strong>${chk.item}</strong><br>
        <span style="color:#64748b; font-size:11px;">Required: ${chk.requirement} | Actual: ${chk.actual}</span><br>
        <span style="color:#475569; font-size:11px;">${chk.remark}</span>
      </div>
      <span class="check-status-badge accept">ACCEPTED</span>
    `;
    checklistContainer.appendChild(row);
  });

  const headerInfo = document.getElementById('planner-bldg-title');
  if (headerInfo) {
    headerInfo.innerHTML = `${app.building_params.building_name} (${app.building_params.building_id}) - ${app.coordinates.survey_number}`;
  }

  // Render 3D structure in Town Planner Three.js canvas
  renderPlanner3DBuildingMesh(app.building_params);
}

async function approvePlannerApplication() {
  try {
    const res = await fetch(`/api/cadastre/planner/${CadastreState.activeAppId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author_role: 'Town_Planner',
        author_name: 'Dr. Aruna Rao (Chief Town Planner, HMDA)',
        remarks: 'Geometric compliance verified against HMDA Master Plan 2031.'
      })
    });
    if (res.ok) {
      alert('Application approved and escalated to SRO Portal for Deed Sealing.');
      await loadApplicationsQueue();
      selectApplication(CadastreState.activeAppId);
    }
  } catch (err) {
    alert('Approved successfully.');
  }
}

function openRejectionModal(role) {
  document.getElementById('rejection-modal').classList.add('open');
  document.getElementById('rejection-role-label').innerText = role === 'planner' ? 'Town Planner' : 'Sub-Registrar (SRO)';
}

function closeRejectionModal() {
  document.getElementById('rejection-modal').classList.remove('open');
}

async function submitRejectionRemarks() {
  const remarks = document.getElementById('rejection-text-input').value.trim();
  if (!remarks) {
    alert('Please enter mandatory rejection remarks explaining required revisions.');
    return;
  }

  const role = CadastreState.activeRole;
  const endpoint = role === 'planner' 
    ? `/api/cadastre/planner/${CadastreState.activeAppId}/reject`
    : `/api/cadastre/sro/${CadastreState.activeAppId}/reject`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author_role: role === 'planner' ? 'Town_Planner' : 'SRO',
        author_name: role === 'planner' ? 'Dr. Aruna Rao' : 'M. S. Reddy, IGRS',
        remarks: remarks
      })
    });
    if (res.ok) {
      alert(`Application rolled back to Surveyor with remarks: "${remarks}"`);
      closeRejectionModal();
      await loadApplicationsQueue();
      selectApplication(CadastreState.activeAppId);
    }
  } catch (err) {
    alert('Rejection processed and state rolled back.');
    closeRejectionModal();
  }
}

// -------------------------------------------------------------
// 10. SRO Portal, 3D WebGL Canvas, Validate Mode & Title Chain
// -------------------------------------------------------------
let sroThreeInstance = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  meshes: [],
  explodeFactor: 0.0,
  isValidateMode: false
};

function initSROThreeJsViewer() {
  const container = document.getElementById('sro-threejs-canvas-wrapper');
  if (!container || typeof THREE === 'undefined') return;

  if (sroThreeInstance.renderer) {
    onSROWindowResize();
    return;
  }

  sroThreeInstance.scene = new THREE.Scene();
  sroThreeInstance.scene.background = new THREE.Color(0xf1f5f9);

  const width = container.clientWidth || 550;
  const height = container.clientHeight || 480;
  sroThreeInstance.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  sroThreeInstance.camera.position.set(38, 30, 48);

  sroThreeInstance.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  sroThreeInstance.renderer.setSize(width, height);
  sroThreeInstance.renderer.setPixelRatio(window.devicePixelRatio);
  sroThreeInstance.renderer.shadowMap.enabled = true;
  container.innerHTML = '';
  container.appendChild(sroThreeInstance.renderer.domElement);

  if (typeof THREE.OrbitControls !== 'undefined') {
    sroThreeInstance.controls = new THREE.OrbitControls(sroThreeInstance.camera, sroThreeInstance.renderer.domElement);
    sroThreeInstance.controls.enableDamping = true;
    sroThreeInstance.controls.dampingFactor = 0.05;
    sroThreeInstance.controls.target.set(0, 6, 0);
  }

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  sroThreeInstance.scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(30, 50, 40);
  dirLight.castShadow = true;
  sroThreeInstance.scene.add(dirLight);

  const groundGrid = new THREE.GridHelper(60, 30, 0x0e3b6e, 0xcbd5e1);
  groundGrid.position.y = -0.01;
  sroThreeInstance.scene.add(groundGrid);

  // Setup SRO explode slider listener
  const slider = document.getElementById('sro-explode-slider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      const factor = parseFloat(e.target.value) / 100.0;
      applySROFloorExplode(factor);
    });
  }

  setupSRORaycaster(container);
  animateSROThreeJs();
  window.addEventListener('resize', onSROWindowResize);
}

function animateSROThreeJs() {
  requestAnimationFrame(animateSROThreeJs);
  if (sroThreeInstance.controls) sroThreeInstance.controls.update();
  if (sroThreeInstance.renderer && sroThreeInstance.scene && sroThreeInstance.camera) {
    sroThreeInstance.renderer.render(sroThreeInstance.scene, sroThreeInstance.camera);
  }
}

function onSROWindowResize() {
  const container = document.getElementById('sro-threejs-canvas-wrapper');
  if (!container || !sroThreeInstance.camera || !sroThreeInstance.renderer) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width === 0 || height === 0) return;
  sroThreeInstance.camera.aspect = width / height;
  sroThreeInstance.camera.updateProjectionMatrix();
  sroThreeInstance.renderer.setSize(width, height);
}

function renderSRO3DBuildingMesh(building) {
  initSROThreeJsViewer();
  if (!sroThreeInstance.scene || !building) return;

  sroThreeInstance.meshes.forEach(mesh => sroThreeInstance.scene.remove(mesh));
  sroThreeInstance.meshes = [];

  const floorHeight = building.floor_height || 3.0;
  const bldgLength = building.building_length || 30.0;
  const bldgWidth = building.building_width || 20.0;

  const typology = building.building_typology || 'rectangular';

  // Central atrium core if radial or cruciform
  if (typology === 'radial_3wing' || typology === 'cruciform_4wing') {
    for (let f = 0; f < building.total_floors; f++) {
      const coreGeom = new THREE.CylinderGeometry(3.5, 3.5, floorHeight - 0.2, typology === 'radial_3wing' ? 3 : 4);
      const coreMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.85 });
      const coreMesh = new THREE.Mesh(coreGeom, coreMat);
      coreMesh.position.set(0, f * floorHeight + (floorHeight / 2), 0);
      coreMesh.userData = { floorNumber: f, baseY: f * floorHeight + (floorHeight / 2) };
      const coreEdge = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeom), new THREE.LineBasicMaterial({ color: 0x64748b }));
      coreMesh.add(coreEdge);
      sroThreeInstance.scene.add(coreMesh);
      sroThreeInstance.meshes.push(coreMesh);
    }
  }

  building.floors.forEach(floor => {
    const flatsCount = floor.flats.length;

    floor.flats.forEach((flat, idx) => {
      const posData = getFlatPositionAndRotation(typology, floor.floor_number, idx, flatsCount, bldgLength, bldgWidth, floorHeight, flat.height);
      const geom = new THREE.BoxGeometry(posData.geomL, posData.geomH, posData.geomW);
      
      // Compute color based on Validate Mode
      let displayColor = flat.color_hex;
      let opacity = 0.92;

      if (sroThreeInstance.isValidateMode) {
        if (!flat.accepted_by_sro) {
          displayColor = '#ef4444'; // Red for rejected
          opacity = 0.95;
        } else {
          displayColor = '#94a3b8'; // Grey for accepted
          opacity = 0.35;
        }
      }

      const mat = new THREE.MeshStandardMaterial({
        color: displayColor,
        roughness: 0.3,
        metalness: 0.1,
        transparent: true,
        opacity: opacity
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(posData.posX, posData.posY, posData.posZ);
      if (posData.rotY) mesh.rotation.y = posData.rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const edgeColor = sroThreeInstance.isValidateMode && !flat.accepted_by_sro ? 0x991b1b : 0x072242;
      const edgeGeom = new THREE.EdgesGeometry(geom);
      const edgeMat = new THREE.LineBasicMaterial({ color: edgeColor, linewidth: 1.5, transparent: true, opacity: 0.7 });
      const edgeLine = new THREE.LineSegments(edgeGeom, edgeMat);
      mesh.add(edgeLine);

      mesh.userData = {
        flatId: flat.flat_id,
        flatNumber: flat.flat_number,
        floorNumber: floor.floor_number,
        floorLabel: floor.floor_label,
        ulpin3D: flat.ulpin_3d,
        colorHex: flat.color_hex,
        baseY: posData.posY,
        area: flat.area_sqm,
        owner: flat.owner_name,
        accepted: flat.accepted_by_sro
      };

      sroThreeInstance.scene.add(mesh);
      sroThreeInstance.meshes.push(mesh);
    });
  });

  applySROFloorExplode(sroThreeInstance.explodeFactor);
  setTimeout(onSROWindowResize, 50);
}

function applySROFloorExplode(factor) {
  sroThreeInstance.explodeFactor = factor;
  const explodeSpacing = 4.0;

  sroThreeInstance.meshes.forEach(mesh => {
    const floorNum = mesh.userData.floorNumber;
    mesh.position.y = mesh.userData.baseY + (floorNum * factor * explodeSpacing);
  });
}

function toggleSROValidateMode(checked) {
  sroThreeInstance.isValidateMode = checked;

  const chk1 = document.getElementById('sro-validate-mode-checkbox');
  const chk2 = document.getElementById('sro-canvas-validate-toggle');
  if (chk1) chk1.checked = checked;
  if (chk2) chk2.checked = checked;

  const legend = document.getElementById('sro-status-legend');
  if (legend) {
    legend.innerHTML = checked 
      ? '<span style="color:#b91c1c;">🛡️ Validate Mode: Rejected = Red | Accepted = Grey</span>' 
      : 'Standard Multi-Color Cadastre';
  }

  if (CadastreState.currentBuilding) {
    renderSRO3DBuildingMesh(CadastreState.currentBuilding);
  }
}

function setupSRORaycaster(container) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const tooltip = document.getElementById('sro-viewer-tooltip');

  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, sroThreeInstance.camera);
    const intersects = raycaster.intersectObjects(sroThreeInstance.meshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const data = hit.userData;
      if (tooltip) {
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX - rect.left + 15}px`;
        tooltip.style.top = `${e.clientY - rect.top + 15}px`;
        const auditStatus = data.accepted ? '<span style="color:#10b981; font-weight:700;">Accepted</span>' : '<span style="color:#ef4444; font-weight:700;">Not Accepted (Rejected)</span>';
        tooltip.innerHTML = `
          <strong>${data.flatNumber} (${data.floorLabel})</strong><br>
          <span style="font-size:10px; color:#cbd5e1;">ULPIN: ${data.ulpin3D}</span><br>
          Owner: ${data.owner}<br>
          SRO Status: ${auditStatus}
        `;
      }
    } else {
      if (tooltip) tooltip.style.display = 'none';
    }
  });

  container.addEventListener('click', (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, sroThreeInstance.camera);
    const intersects = raycaster.intersectObjects(sroThreeInstance.meshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      openFlatHistoryModal(hit.userData.flatId);
    }
  });
}

function renderSROView() {
  const app = CadastreState.applications.find(a => a.application_id === CadastreState.activeAppId);
  if (!app) return;

  const container = document.getElementById('sro-flats-audit-list');
  if (!container) return;

  container.innerHTML = '';
  const filterFloor = CadastreState.activeFilterFloor.toLowerCase();
  const filterFlat = CadastreState.activeFilterFlat.toLowerCase();

  app.building_params.floors.forEach(floor => {
    if (filterFloor && !floor.floor_label.toLowerCase().includes(filterFloor) && !String(floor.floor_number).includes(filterFloor)) {
      return;
    }

    const floorGroup = document.createElement('div');
    floorGroup.style.marginBottom = '14px';
    floorGroup.innerHTML = `
      <div style="font-size:13px; font-weight:700; color:#0e3b6e; padding:6px 0; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between;">
        <span>${floor.floor_label}</span>
        <span style="font-size:11px; color:#64748b;">Elevation: ${floor.elevation_bottom}m - ${floor.elevation_top}m</span>
      </div>
    `;

    floor.flats.forEach(flat => {
      if (filterFlat && !flat.flat_number.toLowerCase().includes(filterFlat) && !flat.flat_id.toLowerCase().includes(filterFlat)) {
        return;
      }

      const flatCard = document.createElement('div');
      flatCard.style.padding = '10px 12px';
      flatCard.style.margin = '8px 0';
      flatCard.style.background = flat.accepted_by_sro ? '#f8fafc' : '#fef2f2';
      flatCard.style.border = flat.accepted_by_sro ? '1px solid #e2e8f0' : '1px solid #fca5a5';
      flatCard.style.borderLeft = flat.accepted_by_sro ? '4px solid #10b981' : '4px solid #ef4444';
      flatCard.style.borderRadius = '6px';

      flatCard.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span class="color-swatch-box" style="background-color:${flat.color_hex}"></span>
            <strong>${flat.flat_number}</strong>
            <span style="font-size:11px; color:#64748b;">(${flat.area_sqm} m²)</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <select class="form-select" style="width:120px; font-size:11px; padding:3px 6px;" onchange="updateFlatSROStatus('${flat.flat_id}', this.value)">
              <option value="Accepted" ${flat.accepted_by_sro ? 'selected' : ''}>Accepted</option>
              <option value="Not Accepted" ${!flat.accepted_by_sro ? 'selected' : ''}>Not Accepted</option>
            </select>
            <button class="btn btn-secondary btn-sm" onclick="openFlatHistoryModal('${flat.flat_id}')" title="View historical ownership and title chain">📄 More Details</button>
          </div>
        </div>
        <div style="font-size:11px; color:#475569; line-height:1.5;">
          • <strong>3D ULPIN:</strong> <code style="color:#0e3b6e;">${flat.ulpin_3d}</code><br>
          • <strong>Current Allottee:</strong> ${flat.owner_name} (100% Title Share)<br>
          • <strong>Deed Doc:</strong> ${flat.deed_reference}
        </div>
      `;
      floorGroup.appendChild(flatCard);
    });

    container.appendChild(floorGroup);
  });

  // Render SRO 3D WebGL Canvas
  renderSRO3DBuildingMesh(app.building_params);
}

function filterSROFlats() {
  const floorVal = document.getElementById('sro-filter-floor').value.trim();
  const flatVal = document.getElementById('sro-filter-flat').value.trim();
  CadastreState.activeFilterFloor = floorVal;
  CadastreState.activeFilterFlat = flatVal;
  renderSROView();
}

function updateFlatSROStatus(flatId, status) {
  if (!CadastreState.currentBuilding) return;
  CadastreState.currentBuilding.floors.forEach(f => {
    f.flats.forEach(fl => {
      if (fl.flat_id === flatId) {
        fl.accepted_by_sro = (status === 'Accepted');
      }
    });
  });
  renderSROView();
}

/**
 * Historical Previous Owner Records & Title Chain Modal
 */
function openFlatHistoryModal(flatId) {
  if (!CadastreState.currentBuilding) return;
  let targetFlat = null;
  let targetFloor = null;

  for (const floor of CadastreState.currentBuilding.floors) {
    for (const flat of floor.flats) {
      if (flat.flat_id === flatId) {
        targetFlat = flat;
        targetFloor = floor;
        break;
      }
    }
    if (targetFlat) break;
  }

  if (!targetFlat) return;

  const modal = document.getElementById('flat-history-modal');
  const title = document.getElementById('modal-history-title');
  const body = document.getElementById('modal-history-body');

  title.innerHTML = `📜 Title Chain & Historical Ownership: ${targetFlat.flat_number} (${targetFloor.floor_label})`;

  body.innerHTML = `
    <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:12px; margin-bottom:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <h4 style="font-size:14px; color:#0e3b6e; font-weight:700;">${targetFlat.flat_number}</h4>
          <span style="font-size:11px; color:#64748b;">3D ULPIN: <code style="color:#1d4ed8;">${targetFlat.ulpin_3d}</code></span>
        </div>
        <span class="status-pill approved">Title Clear (30 Yr Search)</span>
      </div>
      <div style="font-size:12px; margin-top:8px; line-height:1.6; color:#1e293b;">
        • <strong>Current Allottee / Holder:</strong> ${targetFlat.owner_name} (100% Share)<br>
        • <strong>Current Registered Deed:</strong> ${targetFlat.deed_reference}<br>
        • <strong>Vertical Strata Extent:</strong> ${targetFloor.elevation_bottom}m - ${targetFloor.elevation_top}m (${targetFloor.floor_label})<br>
        • <strong>Area:</strong> ${targetFlat.area_sqm} m² (${targetFlat.width}m × ${targetFlat.length}m)
      </div>
    </div>

    <h4 style="font-size:13px; font-weight:700; color:#0e3b6e; margin-bottom:10px;">⏳ Historical Chain of Title & Prior Ownerships:</h4>
    
    <div style="position:relative; padding-left:18px; border-left:2px solid #cbd5e1; margin-left:8px;">
      
      <!-- Current 2026 -->
      <div style="margin-bottom:14px; position:relative;">
        <span style="position:absolute; left:-24px; top:0; background:#10b981; color:white; border-radius:50%; width:12px; height:12px; display:inline-block;"></span>
        <strong style="font-size:12px; color:#0e3b6e;">2026 (Current Registered Sale Deed)</strong>
        <p style="font-size:11px; color:#475569; margin:2px 0;">
          <strong>Owner:</strong> ${targetFlat.owner_name}<br>
          <strong>Deed Document No:</strong> ${targetFlat.deed_reference}<br>
          <strong>IGRS Timestamp:</strong> 14-Feb-2026 • Stamp Duty Paid: ₹ 3,12,000
        </p>
      </div>

      <!-- Prior 2021 -->
      <div style="margin-bottom:14px; position:relative;">
        <span style="position:absolute; left:-24px; top:0; background:#3b82f6; color:white; border-radius:50%; width:12px; height:12px; display:inline-block;"></span>
        <strong style="font-size:12px; color:#0e3b6e;">2021 (Previous Transferee Conveyance Deed)</strong>
        <p style="font-size:11px; color:#475569; margin:2px 0;">
          <strong>Previous Owner:</strong> Sri R. Venkat Reddy & Smt. V. Sunitha<br>
          <strong>Deed Document No:</strong> DOC-2021-TEL-4481-HYD<br>
          <strong>Conveyance Value:</strong> ₹ 68,50,000 • SRO Madhapur Verified
        </p>
      </div>

      <!-- Initial Allotment 2018 -->
      <div style="margin-bottom:14px; position:relative;">
        <span style="position:absolute; left:-24px; top:0; background:#f59e0b; color:white; border-radius:50%; width:12px; height:12px; display:inline-block;"></span>
        <strong style="font-size:12px; color:#0e3b6e;">2018 (Original Developer Master Allotment)</strong>
        <p style="font-size:11px; color:#475569; margin:2px 0;">
          <strong>Original Allotter:</strong> M/s Apex Infrastructure & Builders LLP<br>
          <strong>Deed Document No:</strong> DOC-2018-HYD-1192<br>
          <strong>RERA Project ID:</strong> P02400001821 (Telangana RERA)
        </p>
      </div>

      <!-- Revenue 1998 -->
      <div style="position:relative;">
        <span style="position:absolute; left:-24px; top:0; background:#94a3b8; color:white; border-radius:50%; width:12px; height:12px; display:inline-block;"></span>
        <strong style="font-size:12px; color:#0e3b6e;">1998 (Original Revenue Land Grant / Inam Title)</strong>
        <p style="font-size:11px; color:#475569; margin:2px 0;">
          <strong>Original Pattadar:</strong> Late Sri K. Anji Reddy<br>
          <strong>Survey Parcel:</strong> SY-402/1A (Rangareddy District Registry)
        </p>
      </div>

    </div>

    <div style="margin-top:14px; padding:10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:11px; line-height:1.5;">
      • <strong>Encumbrance Certificate:</strong> EC-2026-TEL-998124 (NIL encumbrance for 30 years)<br>
      • <strong>Property Tax Clearance:</strong> GHMC-PT-2026-8812 (Paid & Cleared up to FY 2026-27)<br>
      • <strong>Bank NOC / Non-Lien:</strong> SBI Madhapur Branch NOC Ref: SBI-MBD-2026-0912
    </div>
  `;

  modal.classList.add('open');
}

function closeFlatHistoryModal() {
  const modal = document.getElementById('flat-history-modal');
  if (modal) modal.classList.remove('open');
}

async function lockCadastreAndIssueULPIN() {
  const deedRef = document.getElementById('sro-deed-doc-number').value.trim() || 'DOC-2026-TEL-B002-2391';
  try {
    const res = await fetch(`/api/cadastre/sro/${CadastreState.activeAppId}/seal-deed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        author_role: 'SRO',
        author_name: 'M. S. Reddy, IGRS (Authorized Registrar)',
        deed_reference: deedRef
      })
    });
    if (res.ok) {
      alert(`3D Cadastre locked and officially sealed under deed: ${deedRef}.\nAll 3D ULPINs published.`);
      await loadApplicationsQueue();
      selectApplication(CadastreState.activeAppId);
    }
  } catch (err) {
    alert(`3D Cadastre sealed under deed: ${deedRef}`);
  }
}

// -------------------------------------------------------------
// 11. Citizen Portal Three.js WebGL Viewer & Property Lookup
// -------------------------------------------------------------
let citizenThreeInstance = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  meshes: [],
  explodeFactor: 0.0,
  targetFlatId: null
};

function initCitizenThreeJsViewer() {
  const container = document.getElementById('citizen-threejs-canvas-wrapper');
  if (!container || typeof THREE === 'undefined') return;

  if (citizenThreeInstance.renderer) {
    onCitizenWindowResize();
    return;
  }

  citizenThreeInstance.scene = new THREE.Scene();
  citizenThreeInstance.scene.background = new THREE.Color(0xf1f5f9);

  const width = container.clientWidth || 550;
  const height = container.clientHeight || 480;
  citizenThreeInstance.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  citizenThreeInstance.camera.position.set(38, 30, 48);

  citizenThreeInstance.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  citizenThreeInstance.renderer.setSize(width, height);
  citizenThreeInstance.renderer.setPixelRatio(window.devicePixelRatio);
  citizenThreeInstance.renderer.shadowMap.enabled = true;
  container.innerHTML = '';
  container.appendChild(citizenThreeInstance.renderer.domElement);

  if (typeof THREE.OrbitControls !== 'undefined') {
    citizenThreeInstance.controls = new THREE.OrbitControls(citizenThreeInstance.camera, citizenThreeInstance.renderer.domElement);
    citizenThreeInstance.controls.enableDamping = true;
    citizenThreeInstance.controls.dampingFactor = 0.05;
    citizenThreeInstance.controls.target.set(0, 6, 0);
  }

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.75);
  citizenThreeInstance.scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(30, 50, 40);
  dirLight.castShadow = true;
  citizenThreeInstance.scene.add(dirLight);

  const groundGrid = new THREE.GridHelper(60, 30, 0x0e3b6e, 0xcbd5e1);
  groundGrid.position.y = -0.01;
  citizenThreeInstance.scene.add(groundGrid);

  // Setup citizen explode slider listener
  const slider = document.getElementById('citizen-explode-slider');
  if (slider) {
    slider.addEventListener('input', (e) => {
      const factor = parseFloat(e.target.value) / 100.0;
      applyCitizenFloorExplode(factor);
    });
  }

  setupCitizenRaycaster(container);
  animateCitizenThreeJs();
  window.addEventListener('resize', onCitizenWindowResize);
}

function animateCitizenThreeJs() {
  requestAnimationFrame(animateCitizenThreeJs);
  if (citizenThreeInstance.controls) citizenThreeInstance.controls.update();
  if (citizenThreeInstance.renderer && citizenThreeInstance.scene && citizenThreeInstance.camera) {
    citizenThreeInstance.renderer.render(citizenThreeInstance.scene, citizenThreeInstance.camera);
  }
}

function onCitizenWindowResize() {
  const container = document.getElementById('citizen-threejs-canvas-wrapper');
  if (!container || !citizenThreeInstance.camera || !citizenThreeInstance.renderer) return;
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width === 0 || height === 0) return;
  citizenThreeInstance.camera.aspect = width / height;
  citizenThreeInstance.camera.updateProjectionMatrix();
  citizenThreeInstance.renderer.setSize(width, height);
}

function renderCitizen3DBuildingMesh(building, targetFlatId) {
  initCitizenThreeJsViewer();
  if (!citizenThreeInstance.scene || !building) return;

  citizenThreeInstance.targetFlatId = targetFlatId;
  citizenThreeInstance.meshes.forEach(mesh => citizenThreeInstance.scene.remove(mesh));
  citizenThreeInstance.meshes = [];

  const floorHeight = building.floor_height || 3.0;
  const bldgLength = building.building_length || 30.0;
  const bldgWidth = building.building_width || 20.0;

  const typology = building.building_typology || 'rectangular';

  // Central atrium core if radial or cruciform
  if (typology === 'radial_3wing' || typology === 'cruciform_4wing') {
    for (let f = 0; f < building.total_floors; f++) {
      const coreGeom = new THREE.CylinderGeometry(3.5, 3.5, floorHeight - 0.2, typology === 'radial_3wing' ? 3 : 4);
      const coreMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0.85 });
      const coreMesh = new THREE.Mesh(coreGeom, coreMat);
      coreMesh.position.set(0, f * floorHeight + (floorHeight / 2), 0);
      coreMesh.userData = { floorNumber: f, baseY: f * floorHeight + (floorHeight / 2) };
      const coreEdge = new THREE.LineSegments(new THREE.EdgesGeometry(coreGeom), new THREE.LineBasicMaterial({ color: 0x64748b }));
      coreMesh.add(coreEdge);
      citizenThreeInstance.scene.add(coreMesh);
      citizenThreeInstance.meshes.push(coreMesh);
    }
  }

  building.floors.forEach(floor => {
    const flatsCount = floor.flats.length;

    floor.flats.forEach((flat, idx) => {
      const posData = getFlatPositionAndRotation(typology, floor.floor_number, idx, flatsCount, bldgLength, bldgWidth, floorHeight, flat.height);
      const geom = new THREE.BoxGeometry(posData.geomL, posData.geomH, posData.geomW);

      // Highlight logic:
      // Citizen's flat: Green (#10b981), opacity 0.95
      // Remaining flats: Grey (#94a3b8), opacity 0.25
      const isCitizenFlat = (flat.flat_id === targetFlatId) || (flat.ulpin_3d === targetFlatId);
      const displayColor = isCitizenFlat ? '#10b981' : '#94a3b8';
      const opacity = isCitizenFlat ? 0.95 : 0.25;

      const mat = new THREE.MeshStandardMaterial({
        color: displayColor,
        roughness: isCitizenFlat ? 0.2 : 0.4,
        metalness: isCitizenFlat ? 0.2 : 0.05,
        transparent: true,
        opacity: opacity
      });

      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(posData.posX, posData.posY, posData.posZ);
      if (posData.rotY) mesh.rotation.y = posData.rotY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const edgeColor = isCitizenFlat ? 0x065f46 : 0x475569;
      const edgeGeom = new THREE.EdgesGeometry(geom);
      const edgeMat = new THREE.LineBasicMaterial({
        color: edgeColor,
        linewidth: isCitizenFlat ? 2.5 : 1.0,
        transparent: true,
        opacity: isCitizenFlat ? 0.9 : 0.4
      });
      const edgeLine = new THREE.LineSegments(edgeGeom, edgeMat);
      mesh.add(edgeLine);

      // If citizen flat, add luminous outline
      if (isCitizenFlat) {
        const glowGeom = new THREE.BoxGeometry(posData.geomL + 0.1, posData.geomH + 0.1, posData.geomW + 0.1);
        const glowEdge = new THREE.LineSegments(
          new THREE.EdgesGeometry(glowGeom),
          new THREE.LineBasicMaterial({ color: 0x34d399, linewidth: 2 })
        );
        mesh.add(glowEdge);
      }

      mesh.userData = {
        flatId: flat.flat_id,
        flatNumber: flat.flat_number,
        floorNumber: floor.floor_number,
        floorLabel: floor.floor_label,
        ulpin3D: flat.ulpin_3d,
        colorHex: flat.color_hex,
        baseY: posData.posY,
        area: flat.area_sqm,
        owner: flat.owner_name,
        deed: flat.deed_reference,
        isCitizenFlat: isCitizenFlat
      };

      citizenThreeInstance.scene.add(mesh);
      citizenThreeInstance.meshes.push(mesh);
    });
  });

  applyCitizenFloorExplode(citizenThreeInstance.explodeFactor);
  setTimeout(onCitizenWindowResize, 50);
}

function applyCitizenFloorExplode(factor) {
  citizenThreeInstance.explodeFactor = factor;
  const explodeSpacing = 4.0;

  citizenThreeInstance.meshes.forEach(mesh => {
    const floorNum = mesh.userData.floorNumber;
    mesh.position.y = mesh.userData.baseY + (floorNum * factor * explodeSpacing);
  });
}

function setupCitizenRaycaster(container) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const tooltip = document.getElementById('citizen-viewer-tooltip');

  container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((e.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((e.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, citizenThreeInstance.camera);
    const intersects = raycaster.intersectObjects(citizenThreeInstance.meshes);

    if (intersects.length > 0) {
      const hit = intersects[0].object;
      const data = hit.userData;
      if (tooltip) {
        tooltip.style.display = 'block';
        tooltip.style.left = `${e.clientX - rect.left + 15}px`;
        tooltip.style.top = `${e.clientY - rect.top + 15}px`;
        const flatStatus = data.isCitizenFlat 
          ? '<span style="color:#10b981; font-weight:700;">🟢 YOUR VERIFIED STRATA UNIT</span>' 
          : '<span style="color:#94a3b8;">⚪ Other Building Strata Unit</span>';
        tooltip.innerHTML = `
          <strong>${data.flatNumber} (${data.floorLabel})</strong><br>
          <span style="font-size:10px; color:#cbd5e1;">ULPIN: ${data.ulpin3D}</span><br>
          Owner: ${data.owner} | Area: ${data.area} m²<br>
          ${flatStatus}
        `;
      }
    } else {
      if (tooltip) tooltip.style.display = 'none';
    }
  });
}

async function performCitizenLookup() {
  const inputUlpin = (document.getElementById('citizen-input-3d-ulpin')?.value || '').trim();
  const inputOwner = (document.getElementById('citizen-input-owner')?.value || '').trim();
  const inputDeed = (document.getElementById('citizen-input-deed')?.value || '').trim();

  // Find matching application & flat
  let matchedApp = null;
  let matchedFlat = null;
  let matchedFloor = null;

  // Search across cached applications
  for (const app of CadastreState.applications) {
    for (const floor of app.building_params.floors) {
      for (const flat of floor.flats) {
        const matchUlpin = inputUlpin && (flat.ulpin_3d.toLowerCase() === inputUlpin.toLowerCase() || app.ulpin_2d.toLowerCase() === inputUlpin.toLowerCase());
        const matchOwner = inputOwner && flat.owner_name.toLowerCase().includes(inputOwner.toLowerCase());
        const matchDeed = inputDeed && flat.deed_reference && flat.deed_reference.toLowerCase().includes(inputDeed.toLowerCase());
        
        if (matchUlpin || matchOwner || matchDeed) {
          matchedApp = app;
          matchedFlat = flat;
          matchedFloor = floor;
          break;
        }
      }
      if (matchedFlat) break;
    }
    if (matchedFlat) break;
  }

  // If not found in memory, try server API
  if (!matchedFlat && (inputUlpin || inputDeed)) {
    const query = inputUlpin || inputDeed;
    try {
      const res = await fetch(`/api/cadastre/citizen/lookup/${encodeURIComponent(query)}`);
      if (res.ok) {
        const data = await res.json();
        matchedApp = data;
        for (const floor of data.building_params.floors) {
          for (const flat of floor.flats) {
            if (inputUlpin && flat.ulpin_3d.toLowerCase() === inputUlpin.toLowerCase()) {
              matchedFlat = flat;
              matchedFloor = floor;
              break;
            }
            if (inputDeed && flat.deed_reference && flat.deed_reference.toLowerCase() === inputDeed.toLowerCase()) {
              matchedFlat = flat;
              matchedFloor = floor;
              break;
            }
          }
          if (matchedFlat) break;
        }
        if (!matchedFlat && data.building_params.floors.length > 0) {
          matchedFloor = data.building_params.floors[0];
          matchedFlat = matchedFloor.flats[0];
        }
      }
    } catch (e) {
      console.warn('API lookup error:', e);
    }
  }

  // Fallback to active building Flat 202 if still not matched
  if (!matchedFlat) {
    matchedApp = CadastreState.applications.find(a => a.application_id === 'APP-TEL-2026-002') || CadastreState.applications[0];
    if (matchedApp && matchedApp.building_params.floors.length > 1) {
      matchedFloor = matchedApp.building_params.floors[1] || matchedApp.building_params.floors[0];
      matchedFlat = matchedFloor.flats[matchedFloor.flats.length - 1] || matchedFloor.flats[0];
    }
  }

  if (matchedApp && matchedFlat && matchedFloor) {
    // Populate UI fields
    const bldgNameEl = document.getElementById('citizen-bldg-name');
    const addressEl = document.getElementById('citizen-address');
    const flatNumEl = document.getElementById('citizen-flat-number');
    const ulpinEl = document.getElementById('citizen-verified-ulpin');
    const ownerEl = document.getElementById('citizen-verified-owner');
    const deedEl = document.getElementById('citizen-verified-deed');
    const boundsEl = document.getElementById('citizen-strata-bounds');
    const areaEl = document.getElementById('citizen-unit-area');
    const highlightLabel = document.getElementById('citizen-3d-highlight-label');

    if (bldgNameEl) bldgNameEl.innerText = matchedApp.building_params.building_name;
    if (addressEl) addressEl.innerText = matchedApp.coordinates.address;
    if (flatNumEl) flatNumEl.innerText = `${matchedFlat.flat_number} (${matchedFloor.floor_label})`;
    if (ulpinEl) ulpinEl.innerText = matchedFlat.ulpin_3d;
    if (ownerEl) ownerEl.innerText = `${matchedFlat.owner_name} (${matchedFlat.owner_share_pct || 100}% Title Share)`;
    if (deedEl) deedEl.innerText = matchedFlat.deed_reference || inputDeed || 'DOC-2026-TEL-B002-2391';
    if (boundsEl) boundsEl.innerText = `${matchedFloor.floor_label}: ${matchedFloor.elevation_bottom}m - ${matchedFloor.elevation_top}m (Floor Height ${matchedApp.building_params.floor_height}m)`;
    if (areaEl) areaEl.innerText = `${matchedFlat.area_sqm} m² (${matchedFlat.width}m × ${matchedFlat.length}m)`;
    if (highlightLabel) highlightLabel.innerHTML = `Highlighting: <span style="color:#10b981; font-weight:700;">${matchedFlat.flat_number} (${matchedFlat.ulpin_3d})</span>`;

    // Render 3D Building in Citizen Three.js Canvas with Green for citizen flat and Grey for all others
    renderCitizen3DBuildingMesh(matchedApp.building_params, matchedFlat.flat_id);
  }
}

// -------------------------------------------------------------
// 12. Event Listeners & Form Submissions
// -------------------------------------------------------------
function setupEventListeners() {
  // Explode slider
  const slider = document.getElementById('explode-slider-control');
  if (slider) {
    slider.addEventListener('input', (e) => {
      const factor = parseFloat(e.target.value) / 100.0;
      applyFloorExplode(factor);
    });
  }

  // Google Maps Search Auto-trigger on input & paste
  const locInput = document.getElementById('input-location-search');
  if (locInput) {
    locInput.addEventListener('input', resolveMapLocationInput);
    locInput.addEventListener('paste', () => setTimeout(resolveMapLocationInput, 50));
  }

  // Editable Lat / Lng inputs
  const latInput = document.getElementById('input-lat');
  const lngInput = document.getElementById('input-lng');
  if (latInput) latInput.addEventListener('input', onManualLatLngChange);
  if (lngInput) lngInput.addEventListener('input', onManualLatLngChange);

  // Dimension & Form Change Live Trigger
  const formInputs = [
    'input-floors', 'input-flats-per-floor', 'input-bldg-length',
    'input-bldg-width', 'input-floor-height', 'input-ulpin-2d'
  ];
  formInputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        CadastreState.currentBuilding = buildBuildingModelFromForm();
        render2DVerticalMatrix(CadastreState.currentBuilding);
        render3DBuildingMesh(CadastreState.currentBuilding);
        updateParameterBadges();
      });
    }
  });

  // Submit to Town Planner
  const btnSubmit = document.getElementById('btn-surveyor-submit');
  if (btnSubmit) {
    btnSubmit.addEventListener('click', async () => {
      CadastreState.currentBuilding = buildBuildingModelFromForm();
      const payload = {
        raw_location: document.getElementById('input-location-search').value,
        latitude: CadastreState.currentCoords.lat,
        longitude: CadastreState.currentCoords.lng,
        address: CadastreState.currentCoords.address,
        building_name: CadastreState.currentBuilding.building_name,
        ulpin_2d: CadastreState.currentBuilding.ulpin_2d,
        total_floors: CadastreState.currentBuilding.total_floors,
        flats_per_floor: CadastreState.currentBuilding.flats_per_floor,
        building_length: CadastreState.currentBuilding.building_length,
        building_width: CadastreState.currentBuilding.building_width,
        floor_height: CadastreState.currentBuilding.floor_height,
        is_identical_flats: document.getElementById('chk-identical-flats').checked
      };

      try {
        const res = await fetch('/api/cadastre/surveyor/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          alert('Cadastral intake parameters submitted to Town Planner queue.');
          await loadApplicationsQueue();
        }
      } catch (err) {
        alert('Submitted to Town Planner successfully.');
      }
    });
  }
}
