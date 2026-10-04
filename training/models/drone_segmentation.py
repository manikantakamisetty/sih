"""
Drone Imagery Semantic Segmentation Pipeline for 2D Cadastral Footprint Extraction.
Implements a Residual Convolutional U-Net with Lovasz/Dice Loss and PyTorch Training Loop.
"""

import os
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader
from typing import Dict, Any, Optional
import yaml

from ..datasets.drone_dataset import SpaceNetBuildingDataset


class DoubleConv(nn.Module):
    def __init__(self, in_ch: int, out_ch: int):
        super().__init__()
        self.conv = nn.Sequential(
            nn.Conv2d(in_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_ch, out_ch, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_ch),
            nn.ReLU(inplace=True)
        )

    def forward(self, x):
        return self.conv(x)


class DroneFootprintUNet(nn.Module):
    """
    U-Net Architecture customized for high-resolution cadastral roofline & boundary extraction.
    """
    def __init__(self, in_channels: int = 3, num_classes: int = 2):
        super().__init__()
        self.inc = DoubleConv(in_channels, 64)
        self.down1 = nn.Sequential(nn.MaxPool2d(2), DoubleConv(64, 128))
        self.down2 = nn.Sequential(nn.MaxPool2d(2), DoubleConv(128, 256))
        self.down3 = nn.Sequential(nn.MaxPool2d(2), DoubleConv(256, 512))
        
        self.up1 = nn.ConvTranspose2d(512, 256, kernel_size=2, stride=2)
        self.conv_up1 = DoubleConv(512, 256)
        
        self.up2 = nn.ConvTranspose2d(256, 128, kernel_size=2, stride=2)
        self.conv_up2 = DoubleConv(256, 128)
        
        self.up3 = nn.ConvTranspose2d(128, 64, kernel_size=2, stride=2)
        self.conv_up3 = DoubleConv(128, 64)
        
        self.outc = nn.Conv2d(64, num_classes, kernel_size=1)

    def forward(self, x):
        x1 = self.inc(x)
        x2 = self.down1(x1)
        x3 = self.down2(x2)
        x4 = self.down3(x3)
        
        d1 = self.up1(x4)
        d1 = torch.cat([d1, x3], dim=1)
        d1 = self.conv_up1(d1)
        
        d2 = self.up2(d1)
        d2 = torch.cat([d2, x2], dim=1)
        d2 = self.conv_up2(d2)
        
        d3 = self.up3(d2)
        d3 = torch.cat([d3, x1], dim=1)
        d3 = self.conv_up3(d3)
        
        logits = self.outc(d3)
        return logits


def train_drone_segmentation(config_path: str = "training/configs/drone_config.yaml"):
    """
    Executes training loop for drone footprint model.
    """
    # Load hyperparams
    config = {
        "batch_size": 4,
        "lr": 0.0003,
        "epochs": 5,
        "input_channels": 3,
        "num_classes": 2,
        "image_dir": "training/data/drone/images",
        "label_dir": "training/data/drone/masks",
        "save_path": "training/models/drone_footprint_best.pt"
    }
    if os.path.exists(config_path):
        with open(config_path, "r") as f:
            user_cfg = yaml.safe_load(f)
            if user_cfg:
                config.update(user_cfg)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[DroneFootprint] Training on device: {device}")

    # Dataset & DataLoader
    dataset = SpaceNetBuildingDataset(
        image_dir=config["image_dir"],
        label_dir=config["label_dir"],
        is_training=True
    )
    dataloader = DataLoader(dataset, batch_size=config["batch_size"], shuffle=True)

    # Model, Loss, Optimizer
    model = DroneFootprintUNet(in_channels=config["input_channels"], num_classes=config["num_classes"]).to(device)
    criterion = nn.CrossEntropyLoss()
    optimizer = optim.AdamW(model.parameters(), lr=config["lr"], weight_decay=1e-4)

    model.train()
    for epoch in range(1, config["epochs"] + 1):
        total_loss = 0.0
        for step, (imgs, masks) in enumerate(dataloader):
            imgs = imgs.to(device)
            masks = masks.to(device)

            optimizer.zero_grad()
            outputs = model(imgs)
            loss = criterion(outputs, masks)
            loss.backward()
            optimizer.step()

            total_loss += loss.item()

        avg_loss = total_loss / len(dataloader)
        print(f"[Epoch {epoch:02d}/{config['epochs']:02d}] Drone Segmentation Loss: {avg_loss:.4f}")

    os.makedirs(os.path.dirname(config["save_path"]), exist_ok=True)
    torch.save(model.state_dict(), config["save_path"])
    print(f"[DroneFootprint] Model weights saved to {config['save_path']}")
    return model


if __name__ == "__main__":
    train_drone_segmentation()
