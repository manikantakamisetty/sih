"""
3D LiDAR Point Cloud Semantic Segmentation Pipeline
Implements PointNet / PointNet++ architecture for extracting building envelopes and roof surfaces.
"""

import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from typing import Dict, Any, Optional
import yaml

from ..datasets.lidar_dataset import ISPRSPointcloudDataset


class PointNetSeg(nn.Module):
    """
    PointNet Segmentation Architecture for 3D Cadastral Volumetric Point Classification.
    """
    def __init__(self, in_channels: int = 3, num_classes: int = 4):
        super().__init__()
        # Shared MLPs
        self.conv1 = nn.Conv1d(in_channels, 64, 1)
        self.conv2 = nn.Conv1d(64, 128, 1)
        self.conv3 = nn.Conv1d(128, 512, 1)
        
        self.bn1 = nn.BatchNorm1d(64)
        self.bn2 = nn.BatchNorm1d(128)
        self.bn3 = nn.BatchNorm1d(512)
        self.relu = nn.ReLU(inplace=True)

        # Classification MLPs (concatenates local feature + global feature)
        self.conv4 = nn.Conv1d(512 + 64, 256, 1)
        self.conv5 = nn.Conv1d(256, 128, 1)
        self.conv6 = nn.Conv1d(128, num_classes, 1)
        
        self.bn4 = nn.BatchNorm1d(256)
        self.bn5 = nn.BatchNorm1d(128)

    def forward(self, x):
        # x: (B, 3, N)
        num_pts = x.size(2)
        
        out1 = self.relu(self.bn1(self.conv1(x)))      # (B, 64, N)
        out2 = self.relu(self.bn2(self.conv2(out1)))   # (B, 128, N)
        out3 = self.relu(self.bn3(self.conv3(out2)))   # (B, 512, N)

        # Global feature via Max Pooling
        global_feat = torch.max(out3, 2, keepdim=True)[0]  # (B, 512, 1)
        global_feat_expanded = global_feat.repeat(1, 1, num_pts)  # (B, 512, N)

        # Point feature concatenation
        concat_feat = torch.cat([out1, global_feat_expanded], dim=1)  # (B, 576, N)

        out4 = self.relu(self.bn4(self.conv4(concat_feat)))
        out5 = self.relu(self.bn5(self.conv5(out4)))
        logits = self.conv6(out5)  # (B, num_classes, N)
        return logits


def train_lidar_classification(config_path: str = "training/configs/lidar_config.yaml"):
    """
    Executes training loop for 3D point cloud model.
    """
    config = {
        "batch_size": 8,
        "lr": 0.001,
        "epochs": 5,
        "num_points": 2048,
        "num_classes": 4,
        "pointcloud_dir": "training/data/lidar/las",
        "save_path": "training/models/lidar_pointnet_best.pt"
    }
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            user_cfg = yaml.safe_load(f)
            if user_cfg:
                config.update(user_cfg)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[LiDARClassification] Training on device: {device}")

    dataset = ISPRSPointcloudDataset(
        pointcloud_dir=config["pointcloud_dir"],
        num_points=config["num_points"],
        is_training=True
    )
    dataloader = DataLoader(dataset, batch_size=config["batch_size"], shuffle=True)

    model = PointNetSeg(in_channels=3, num_classes=config["num_classes"]).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.Adam(model.parameters(), lr=config["lr"])

    model.train()
    for epoch in range(1, config["epochs"] + 1):
        total_loss = 0.0
        for step, (pts, labels) in enumerate(dataloader):
            pts = pts.to(device)
            labels = labels.to(device)

            optimizer.zero_grad()
            logits = model(pts)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()

            total_loss += loss.item()

        avg_loss = total_loss / len(dataloader)
        print(f"[Epoch {epoch:02d}/{config['epochs']:02d}] LiDAR PointNet Loss: {avg_loss:.4f}")

    os.makedirs(os.path.dirname(config["save_path"]), exist_ok=True)
    torch.save(model.state_dict(), config["save_path"])
    print(f"[LiDARClassification] Model weights saved to {config['save_path']}")
    return model


if __name__ == "__main__":
    train_lidar_classification()
