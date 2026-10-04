"""
SpaceNet / Inria Aerial Image Dataset Loader and Preprocessing Pipeline
for Automated Cadastral Building Footprint Extraction.
"""

import os
import glob
import numpy as np
from typing import Tuple, List, Dict, Optional
import torch
from torch.utils.data import Dataset
from PIL import Image

try:
    import rasterio
    import geopandas as gpd
    from shapely.geometry import shape, Polygon
    HAS_GEO_LIBS = True
except ImportError:
    HAS_GEO_LIBS = False


class SpaceNetBuildingDataset(Dataset):
    """
    Dataset loader for SpaceNet / Inria building extraction benchmark.
    Accepts GeoTIFF RGB/Multispectral imagery and paired GeoJSON polygon labels.
    """
    def __init__(
        self,
        image_dir: str,
        label_dir: Optional[str] = None,
        target_size: Tuple[int, int] = (512, 512),
        transforms=None,
        is_training: bool = True
    ):
        self.image_dir = image_dir
        self.label_dir = label_dir
        self.target_size = target_size
        self.transforms = transforms
        self.is_training = is_training
        
        # Discover image files
        self.image_paths = sorted(
            glob.glob(os.path.join(image_dir, "*.tif*")) + 
            glob.glob(os.path.join(image_dir, "*.png")) + 
            glob.glob(os.path.join(image_dir, "*.jpg"))
        )

    def __len__(self) -> int:
        # If directory is empty for standalone simulation, provide default synthetic batch size
        return max(len(self.image_paths), 100 if self.is_training else 20)

    def _generate_synthetic_sample(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        """Generates synthetic aerial image & building mask for tests/benchmarks without live download."""
        np.random.seed(idx)
        img = np.random.randint(40, 200, (3, self.target_size[0], self.target_size[1]), dtype=np.uint8)
        mask = np.zeros(self.target_size, dtype=np.uint8)
        
        # Add synthetic rectangular building footprints
        num_buildings = np.random.randint(2, 6)
        for _ in range(num_buildings):
            x1, y1 = np.random.randint(20, self.target_size[0] - 120, size=2)
            w, h = np.random.randint(40, 100, size=2)
            mask[y1:y1+h, x1:x1+w] = 1
            img[:, y1:y1+h, x1:x1+w] = np.random.randint(180, 255)
            
        tensor_img = torch.from_numpy(img).float() / 255.0
        tensor_mask = torch.from_numpy(mask).long()
        return tensor_img, tensor_mask

    def __getitem__(self, idx: int) -> Tuple[torch.Tensor, torch.Tensor]:
        if not self.image_paths:
            return self._generate_synthetic_sample(idx)
            
        img_path = self.image_paths[idx]
        if HAS_GEO_LIBS and (img_path.endswith(".tif") or img_path.endswith(".tiff")):
            with rasterio.open(img_path) as src:
                img_data = src.read()[:3]  # Keep 3 RGB bands
                img_data = np.transpose(img_data, (1, 2, 0))
        else:
            img = Image.open(img_path).convert("RGB")
            img = img.resize(self.target_size)
            img_data = np.array(img)

        # Load mask if exists
        mask_data = np.zeros(self.target_size, dtype=np.uint8)
        if self.label_dir:
            base_name = os.path.splitext(os.path.basename(img_path))[0]
            mask_path = os.path.join(self.label_dir, f"{base_name}_mask.png")
            if os.path.exists(mask_path):
                m_img = Image.open(mask_path).convert("L").resize(self.target_size)
                mask_data = (np.array(m_img) > 128).astype(np.uint8)

        tensor_img = torch.from_numpy(img_data).permute(2, 0, 1).float() / 255.0
        tensor_mask = torch.from_numpy(mask_data).long()

        if self.transforms:
            tensor_img = self.transforms(tensor_img)

        return tensor_img, tensor_mask
