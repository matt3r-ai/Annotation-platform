# Annotation Platform - 简化版

基于Web的GPS数据可视化和视频截取平台

## 快速开始

### 使用 Docker（推荐）

```bash
# 1. 配置AWS凭证
# 编辑 .env 文件，填入你的AWS凭证

# 2. 启动应用
docker-compose up -d

# 3. 访问应用
# 前端: http://localhost:3000
# 后端: http://localhost:8000
```

### 手动启动

```bash
# 后端
cd backend
pip install -r requirements.txt
python main.py

# 前端
cd frontend
npm install
npm start
```

## 功能

- S3数据连接
- GPS轨迹可视化
- 视频时间戳截取
- 简洁的用户界面
