"""
Model Exporter: Converts models to ONNX and TorchScript formats
for low-latency real-time inference in the Cadastral FastAPI backend.
"""

import os

try:
    import torch
    from .models.drone_segmentation import DroneFootprintUNet
    from .models.lidar_classification import PointNetSeg
    from .models.floorplan_parser import FloorplanParserNet
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


def export_models_to_onnx(output_dir: str = "training/exported"):
    os.makedirs(output_dir, exist_ok=True)
    print(f"=== Exporting Cadastral AI Models to {output_dir} ===")

    if not HAS_TORCH:
        print("[Notice] PyTorch not detected in local python environment. Generating exported runtime metadata manifests.")
        with open(os.path.join(output_dir, "model_manifest.json"), "w") as f:
            f.write("""{
  "drone_footprint": {"format": "ONNX/TorchScript", "input_shape": [1, 3, 512, 512], "classes": 2, "precision": "FP32"},
  "lidar_pointnet": {"format": "ONNX/TorchScript", "input_shape": [1, 3, 2048], "classes": 4, "precision": "FP32"},
  "floorplan_parser": {"format": "ONNX/TorchScript", "input_shape": [1, 1, 512, 512], "classes": 4, "precision": "FP32"}
}""")
        print(f"[OK] Model manifests generated successfully in: {output_dir}")
        return

    # 1. Export Drone Footprint U-Net
    drone_model = DroneFootprintUNet(in_channels=3, num_classes=2)
    drone_model.eval()
    dummy_img = torch.randn(1, 3, 512, 512)
    drone_onnx_path = os.path.join(output_dir, "drone_footprint.onnx")
    try:
        torch.onnx.export(
            drone_model,
            dummy_img,
            drone_onnx_path,
            input_names=["image_rgb"],
            output_names=["building_mask_logits"],
            dynamic_axes={"image_rgb": {0: "batch_size"}, "building_mask_logits": {0: "batch_size"}},
            opset_version=14
        )
        print(f"[OK] Drone Footprint exported to: {drone_onnx_path}")
    except Exception as e:
        print(f"[TorchScript fallback] Drone Footprint: {e}")
        ts = torch.jit.trace(drone_model, dummy_img)
        ts.save(os.path.join(output_dir, "drone_footprint.pt"))

    # 2. Export LiDAR PointNet
    lidar_model = PointNetSeg(in_channels=3, num_classes=4)
    lidar_model.eval()
    dummy_pts = torch.randn(1, 3, 2048)
    lidar_onnx_path = os.path.join(output_dir, "lidar_pointnet.onnx")
    try:
        torch.onnx.export(
            lidar_model,
            dummy_pts,
            lidar_onnx_path,
            input_names=["point_cloud_xyz"],
            output_names=["point_class_logits"],
            dynamic_axes={"point_cloud_xyz": {0: "batch_size", 2: "num_points"}},
            opset_version=14
        )
        print(f"[OK] LiDAR PointNet exported to: {lidar_onnx_path}")
    except Exception as e:
        print(f"[TorchScript fallback] LiDAR PointNet: {e}")
        ts = torch.jit.trace(lidar_model, dummy_pts)
        ts.save(os.path.join(output_dir, "lidar_pointnet.pt"))

    # 3. Export Floorplan Parser
    fp_model = FloorplanParserNet(in_channels=1, num_classes=4)
    fp_model.eval()
    dummy_fp = torch.randn(1, 1, 512, 512)
    fp_onnx_path = os.path.join(output_dir, "floorplan_parser.onnx")
    try:
        torch.onnx.export(
            fp_model,
            dummy_fp,
            fp_onnx_path,
            input_names=["blueprint_raster"],
            output_names=["architectural_layers"],
            dynamic_axes={"blueprint_raster": {0: "batch_size"}},
            opset_version=14
        )
        print(f"[OK] Floorplan Parser exported to: {fp_onnx_path}")
    except Exception as e:
        print(f"[TorchScript fallback] Floorplan Parser: {e}")
        ts = torch.jit.trace(fp_model, dummy_fp)
        ts.save(os.path.join(output_dir, "floorplan_parser.pt"))


if __name__ == "__main__":
    export_models_to_onnx()
