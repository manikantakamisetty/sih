# 3D Cadastral Machine Learning & Spatial AI Training Pipelines

This folder provides production-ready training pipelines for automated 2D building footprint extraction, 3D LiDAR point cloud semantic classification, and architectural blueprint floor plan parsing.

---

## Directory Structure

```
/training/
├── configs/
│   ├── drone_config.yaml         # SpaceNet/Inria footprint extraction configuration
│   ├── lidar_config.yaml         # ISPRS 3D point cloud classification configuration
│   └── floorplan_config.yaml     # CVC-FP blueprint layout parser configuration
├── datasets/
│   ├── drone_dataset.py          # GeoTIFF raster & GeoJSON polygon loader
│   ├── lidar_dataset.py          # LAS/LAZ point cloud normalizer & loader
│   └── floorplan_dataset.py      # Architectural blueprint raster loader
├── models/
│   ├── drone_segmentation.py     # Residual U-Net segmentation pipeline
│   ├── lidar_classification.py   # PointNet / PointNet++ 3D classification pipeline
│   └── floorplan_parser.py       # Multi-scale CNN wall & unit boundary extractor
├── evaluate.py                   # Benchmark evaluator (mIoU, Precision, Recall, F1)
├── export_weights.py             # ONNX / TorchScript model exporter
└── README.md                     # Training documentation & user guide
```

---

## 1. Downloading Open-Source Datasets

### A. Drone Aerial Imagery (SpaceNet 2 / Inria Aerial Image Benchmark)
- **SpaceNet 2 Building Detection Dataset**: [SpaceNet on AWS](https://spacenet.ai/spacenet-dataset-overview/)
  ```bash
  # Download SpaceNet Rio/Vegas AOI
  aws s3 cp s3://spacenet-dataset/spacenet/AOI_2_Vegas/ ./training/data/drone/ --recursive
  ```
- **Inria Aerial Image Labeling**: [Inria Benchmark](https://project.inria.fr/aerialimagelabeling/)

### B. 3D LiDAR Point Clouds (ISPRS Vaihingen / Toronto 3D Benchmark)
- **ISPRS 3D Semantic Labeling Contest**: [ISPRS Working Group](https://www.isprs.org/education/benchmarks/UrbanSemLab/default.aspx)
  ```bash
  # Place .las/.laz files in:
  ./training/data/lidar/las/
  ```

### C. Architectural Blueprint Floor Plans (CVC-FP & CubiCasa5k)
- **CVC-FP**: [Computer Vision Center](http://dag.cvc.uab.es/resources/floorplans_dataset/)
- **CubiCasa5k**: [CubiCasa5k Dataset](https://github.com/CubiCasa/CubiCasa5k)
  ```bash
  # Place floor plan images in:
  ./training/data/floorplans/
  ```

---

## 2. Running Training Loops

You can execute isolated training loops with custom YAML configurations:

### 1. Train Drone Footprint Model
```bash
python -m training.models.drone_segmentation
```

### 2. Train 3D LiDAR Point Cloud Model
```bash
python -m training.models.lidar_classification
```

### 3. Train Architectural Floorplan Parser
```bash
python -m training.models.floorplan_parser
```

---

## 3. Running Benchmark Evaluation

Calculate mIoU, Precision, Recall, and F1-Scores across all three models:
```bash
python -m training.evaluate
```

Sample output:
```
=== Cadastral ML Evaluation Suite (Device: cpu) ===
1. Drone Footprint Metrics: {'mIoU': 0.8842, 'Precision': 0.9124, 'Recall': 0.8911, 'F1_Score': 0.9016, 'Building_Class_IoU': 0.8621}
2. LiDAR Semantic Metrics: {'mIoU': 0.8351, 'Precision': 0.8640, 'Recall': 0.8412, 'F1_Score': 0.8524}
3. Floorplan Parser Metrics: {'mIoU': 0.8719, 'Precision': 0.8950, 'Recall': 0.8804, 'F1_Score': 0.8876}
```

---

## 4. Exporting Trained Weights for Inference

Export trained PyTorch checkpoints to portable ONNX and TorchScript formats for the FastAPI backend:
```bash
python -m training.export_weights
```
Models will be saved to `./training/exported/`:
- `drone_footprint.onnx`
- `lidar_pointnet.onnx`
- `floorplan_parser.onnx`
