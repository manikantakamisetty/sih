"""
Architectural Floorplan Parser & Cadastral Unit Boundary Extractor.
Parses multi-unit floor plans, extracts wall contours, and outputs vector polygon boundaries.
"""

import os
import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from typing import Dict, List, Any, Tuple
import yaml

from ..datasets.floorplan_dataset import CVCLFloorplanDataset


class FloorplanParserNet(nn.Module):
    """
    Multi-Scale CNN for Floorplan Architectural Feature Extraction.
    Classes: 0: Background, 1: Outer Wall, 2: Divider Wall, 3: Unit Space.
    """
    def __init__(self, in_channels: int = 1, num_classes: int = 4):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Conv2d(in_channels, 32, 3, padding=1),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Conv2d(32, 64, 3, padding=1),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),  # 256x256
            nn.Conv2d(64, 128, 3, padding=1),
            nn.BatchNorm2d(128),
            nn.ReLU(inplace=True),
            nn.MaxPool2d(2),  # 128x128
        )
        self.decoder = nn.Sequential(
            nn.ConvTranspose2d(128, 64, 2, stride=2),
            nn.BatchNorm2d(64),
            nn.ReLU(inplace=True),
            nn.ConvTranspose2d(64, 32, 2, stride=2),
            nn.BatchNorm2d(32),
            nn.ReLU(inplace=True),
            nn.Conv2d(32, num_classes, 1)
        )

    def forward(self, x):
        feat = self.encoder(x)
        out = self.decoder(feat)
        return out


def extract_unit_polygons_from_mask(mask: np.ndarray) -> List[Dict[str, Any]]:
    """
    Extracts vectorized unit polygons from segmentation mask using OpenCV contours.
    """
    units = []
    # Unit space is class 3
    unit_mask = (mask == 3).astype(np.uint8) * 255
    contours, _ = cv2.findContours(unit_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    for idx, cnt in enumerate(contours):
        area = cv2.contourArea(cnt)
        if area > 100:  # Filter out noise
            epsilon = 0.02 * cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, epsilon, True)
            polygon_coords = approx.reshape(-1, 2).tolist()
            units.append({
                "unit_index": idx + 1,
                "area_pixels": float(area),
                "polygon": polygon_coords
            })
    return units


def train_floorplan_parser(config_path: str = "training/configs/floorplan_config.yaml"):
    """
    Executes training loop for floorplan layout model.
    """
    config = {
        "batch_size": 4,
        "lr": 0.0005,
        "epochs": 5,
        "num_classes": 4,
        "floorplan_dir": "training/data/floorplans",
        "save_path": "training/models/floorplan_parser_best.pt"
    }
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            user_cfg = yaml.safe_load(f)
            if user_cfg:
                config.update(user_cfg)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[FloorplanParser] Training on device: {device}")

    dataset = CVCLFloorplanDataset(floorplan_dir=config["floorplan_dir"], is_training=True)
    dataloader = DataLoader(dataset, batch_size=config["batch_size"], shuffle=True)

    model = FloorplanParserNet(in_channels=1, num_classes=config["num_classes"]).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=config["lr"])

    model.train()
    for epoch in range(1, config["epochs"] + 1):
        total_loss = 0.0
        for step, (imgs, masks) in enumerate(dataloader):
            imgs = imgs.to(device)
            masks = masks.to(device)

            optimizer.zero_grad()
            logits = model(imgs)
            loss = criterion(logits, masks)
            loss.backward()
            optimizer.step()

            total_loss += loss.item()

        avg_loss = total_loss / len(dataloader)
        print(f"[Epoch {epoch:02d}/{config['epochs']:02d}] Floorplan Parser Loss: {avg_loss:.4f}")

    os.makedirs(os.path.dirname(config["save_path"]), exist_ok=True)
    torch.save(model.state_dict(), config["save_path"])
    print(f"[FloorplanParser] Model weights saved to {config['save_path']}")
    return model


if __name__ == "__main__":
    train_floorplan_parser()
