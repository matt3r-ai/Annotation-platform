# Volume Structure Documentation

## Overview
The MATT3R Annotation Platform now uses a unified volume structure for better infrastructure management and data organization.

## Volume Configuration

### Before (Multiple Bind Mounts)
```yaml
volumes:
  - ./saved_video:/app/saved_video
  - ./backend/downloads:/app/downloads
```

### After (Unified Named Volume)
```yaml
volumes:
  - annotation-platform-backend-volume:/app/data
```

## Directory Structure

The unified volume `annotation-platform-backend-volume` is mounted to `/app/data` in the container, containing:

```
/app/data/
├── saved_video/          # Video files and clips
│   ├── frames/          # Extracted video frames
│   └── local/           # Local video processing
└── downloads/            # Downloaded S3 files
    └── scenario_*.mp4    # Scenario videos
```

## Benefits

✅ **Single Volume Management**: One volume to backup, restore, and manage
✅ **Cleaner Infrastructure**: Simplified docker-compose.yml
✅ **Better Data Organization**: Logical directory structure
✅ **Easier Maintenance**: Centralized data location
✅ **Portable**: Volume can be easily moved between environments

## Implementation Details

### Docker Compose
- Uses named volume `annotation-platform-backend-volume`
- Mounted to `/app/data` in backend container
- Automatically created by Docker

### Backend Code Changes
- `STATIC_DIR` updated to `/app/data/saved_video`
- All hardcoded paths updated to use `/app/data/` structure
- Automatic directory creation in Dockerfile

### Startup Script
- Creates local `./data/` directory structure for development
- Ensures proper permissions and directory existence

## Migration Notes

When upgrading from the old structure:
1. Data in old `./saved_video` and `./backend/downloads` directories will not be automatically migrated
2. You may need to manually copy data to the new volume structure
3. The new structure is backward compatible for new data

## Usage Examples

### Accessing Data in Backend
```python
# Video files
video_dir = "/app/data/saved_video"
local_video_dir = "/app/data/saved_video/local"

# Downloads
download_dir = "/app/data/downloads"
```

### Volume Management Commands
```bash
# List volumes
docker volume ls

# Inspect volume
docker volume inspect annotation-platform-backend-volume

# Backup volume (example)
docker run --rm -v annotation-platform-backend-volume:/data -v $(pwd):/backup alpine tar czf /backup/volume-backup.tar.gz -C /data .

# Restore volume (example)
docker run --rm -v annotation-platform-backend-volume:/data -v $(pwd):/backup alpine tar xzf /backup/volume-backup.tar.gz -C /data
```

## Troubleshooting

### Volume Not Found
```bash
# Create volume manually if needed
docker volume create annotation-platform-backend-volume
```

### Permission Issues
```bash
# Check volume permissions
docker run --rm -v annotation-platform-backend-volume:/data alpine ls -la /data
```

### Data Loss Prevention
- Always backup the volume before major changes
- Test volume operations in development environment first
- Use volume inspection to verify data integrity
